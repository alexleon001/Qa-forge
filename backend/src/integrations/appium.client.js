// Cliente del protocolo W3C WebDriver / Appium sobre HTTP (sin dependencias: usa
// `fetch` nativo, igual que jira.client.js). Habla con cualquier endpoint Appium:
// local (http://localhost:4723), BrowserStack o Sauce Labs (hub URL + Basic auth).
// Cubre lo necesario para el Native Runner: crear/cerrar sesión, buscar elementos,
// tap/type/clear, leer texto/visibilidad, screenshot, back, keycode y swipe.

const DEFAULT_TIMEOUT_MS = 30_000;

// Clave mágica del W3C para el id de elemento.
const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

export class AppiumError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppiumError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Resuelve { base, headers } desde un NativeProvider. Para cloud arma el Basic
 * auth con username + accessKey (ya descifrado). `base` sin trailing slash.
 */
export function resolveEndpoint(provider, accessKey) {
  const type = provider.type;
  const trim = (u) => String(u ?? '').replace(/\/+$/, '');
  if (type === 'local') {
    const base = trim(provider.appiumUrl || 'http://localhost:4723');
    return { base, headers: {} };
  }
  // Cloud: BrowserStack / Sauce. base = hub URL configurada o default.
  const defaults = {
    browserstack: 'https://hub-cloud.browserstack.com/wd/hub',
    saucelabs: provider.region
      ? `https://ondemand.${provider.region}.saucelabs.com/wd/hub`
      : 'https://ondemand.us-west-1.saucelabs.com/wd/hub',
  };
  const base = trim(provider.appiumUrl || defaults[type] || '');
  if (!base) throw new AppiumError(400, 'NO_ENDPOINT', `Sin endpoint Appium para el provider ${type}`);
  if (!provider.username || !accessKey) {
    throw new AppiumError(400, 'MISSING_CREDENTIALS', `username y accessKey requeridos para ${type}`);
  }
  const auth = Buffer.from(`${provider.username}:${accessKey}`).toString('base64');
  return { base, headers: { Authorization: `Basic ${auth}` } };
}

async function appiumRequest(endpoint, method, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${endpoint.base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...endpoint.headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppiumError(504, 'APPIUM_TIMEOUT', `Appium no respondió a tiempo (${timeoutMs}ms)`);
    }
    throw new AppiumError(502, 'APPIUM_UNREACHABLE', `No se pudo conectar a Appium (${endpoint.base}): ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  let json = null;
  const text = await res.text().catch(() => '');
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const val = json?.value ?? {};
    const msg = val.message || val.error || text || `HTTP ${res.status}`;
    throw new AppiumError(res.status, val.error || 'APPIUM_ERROR', truncate(msg, 400));
  }
  return json?.value;
}

// ─── Sesión ──────────────────────────────────────────────────────────────────

/** Crea una sesión. `capabilities` es el objeto plano (ya con prefijos appium:). */
export async function createSession(endpoint, capabilities, timeoutMs = 120_000) {
  const value = await appiumRequest(
    endpoint,
    'POST',
    '/session',
    { capabilities: { alwaysMatch: capabilities, firstMatch: [{}] } },
    timeoutMs,
  );
  const sessionId = value?.sessionId ?? value?.session_id;
  if (!sessionId) throw new AppiumError(502, 'NO_SESSION', 'Appium no devolvió sessionId');
  return { sessionId, capabilities: value?.capabilities ?? null };
}

export async function deleteSession(endpoint, sessionId) {
  if (!sessionId) return;
  await appiumRequest(endpoint, 'DELETE', `/session/${sessionId}`, undefined, 15_000).catch(() => {});
}

/** GET /status — chequeo de conectividad sin sesión. */
export async function getStatus(endpoint, timeoutMs = 10_000) {
  return appiumRequest(endpoint, 'GET', '/status', undefined, timeoutMs);
}

// ─── Elementos ───────────────────────────────────────────────────────────────

function extractElementId(value) {
  if (!value || typeof value !== 'object') return null;
  return value[W3C_ELEMENT_KEY] ?? value.ELEMENT ?? null;
}

/** Busca un elemento. Lanza AppiumError 404 si no existe. Devuelve el elementId. */
export async function findElement(endpoint, sessionId, using, value, timeoutMs) {
  const result = await appiumRequest(endpoint, 'POST', `/session/${sessionId}/element`, { using, value }, timeoutMs);
  const id = extractElementId(result);
  if (!id) throw new AppiumError(404, 'NO_ELEMENT', `Elemento no encontrado (${using}=${value})`);
  return id;
}

export function clickElement(endpoint, sessionId, elementId, timeoutMs) {
  return appiumRequest(endpoint, 'POST', `/session/${sessionId}/element/${elementId}/click`, {}, timeoutMs);
}

export function sendKeys(endpoint, sessionId, elementId, text, timeoutMs) {
  // Appium acepta `text`; algunos drivers requieren también `value` (array de chars).
  return appiumRequest(
    endpoint,
    'POST',
    `/session/${sessionId}/element/${elementId}/value`,
    { text: String(text), value: String(text).split('') },
    timeoutMs,
  );
}

export function clearElement(endpoint, sessionId, elementId, timeoutMs) {
  return appiumRequest(endpoint, 'POST', `/session/${sessionId}/element/${elementId}/clear`, {}, timeoutMs);
}

export async function getElementText(endpoint, sessionId, elementId, timeoutMs) {
  const v = await appiumRequest(endpoint, 'GET', `/session/${sessionId}/element/${elementId}/text`, undefined, timeoutMs);
  return typeof v === 'string' ? v : '';
}

export async function isElementDisplayed(endpoint, sessionId, elementId, timeoutMs) {
  const v = await appiumRequest(endpoint, 'GET', `/session/${sessionId}/element/${elementId}/displayed`, undefined, timeoutMs).catch(() => false);
  return Boolean(v);
}

// ─── Acciones globales ───────────────────────────────────────────────────────

export function goBack(endpoint, sessionId, timeoutMs) {
  return appiumRequest(endpoint, 'POST', `/session/${sessionId}/back`, {}, timeoutMs);
}

/** Android: press_keycode. También mapea nombres comunes (home/back/enter). */
export function pressKeycode(endpoint, sessionId, keycode, timeoutMs) {
  return appiumRequest(endpoint, 'POST', `/session/${sessionId}/appium/device/press_keycode`, { keycode }, timeoutMs);
}

export async function getWindowRect(endpoint, sessionId, timeoutMs) {
  const v = await appiumRequest(endpoint, 'GET', `/session/${sessionId}/window/rect`, undefined, timeoutMs).catch(() => null);
  return v || { width: 1080, height: 1920, x: 0, y: 0 };
}

/** Swipe vía W3C pointer actions entre dos puntos. */
export function performSwipe(endpoint, sessionId, from, to, timeoutMs) {
  const actions = [
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: Math.round(from.x), y: Math.round(from.y) },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 100 },
        { type: 'pointerMove', duration: 400, x: Math.round(to.x), y: Math.round(to.y) },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ];
  return appiumRequest(endpoint, 'POST', `/session/${sessionId}/actions`, { actions }, timeoutMs);
}

export async function takeScreenshot(endpoint, sessionId, timeoutMs) {
  const v = await appiumRequest(endpoint, 'GET', `/session/${sessionId}/screenshot`, undefined, timeoutMs).catch(() => null);
  return typeof v === 'string' ? v : null;
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
