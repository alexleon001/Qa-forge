// Native Runner (#15): ejecuta un NativeFlow sobre una app móvil vía Appium
// (W3C WebDriver). Paralelo determinista a flow.runner.js, pero hablando con un
// endpoint Appium (local o cloud) en vez de Playwright. Crea una sesión, corre
// los pasos (tap/type/swipe/asserts native), saca screenshot en los fallos y
// cierra la sesión. No requiere browser local: todo es HTTP contra el endpoint.

import {
  AppiumError,
  clearElement,
  clickElement,
  createSession,
  deleteSession,
  findElement,
  getElementText,
  getWindowRect,
  goBack,
  isElementDisplayed,
  performSwipe,
  pressKeycode,
  resolveEndpoint,
  sendKeys,
  takeScreenshot,
} from '../integrations/appium.client.js';
import {
  DEFAULT_NATIVE_STRATEGY,
  FLOW_RUN_STATUS,
  FLOW_STEP_STATUS,
  NATIVE_ACTIONS,
  NATIVE_PLATFORMS,
  NATIVE_STEP_TIMEOUT_MS,
} from '../../../shared/constants.js';

const WAIT_FOR_POLL_MS = 600;
const MAX_WAIT_MS = 30_000;
const ANDROID_KEYCODES = { home: 3, back: 4, enter: 66, search: 84, menu: 82, delete: 67 };

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms en ${label}`)), ms)),
  ]);
}

/** Construye las capabilities W3C (prefijo appium: para las no estándar). */
function buildCapabilities(flow, provider) {
  const platform = NATIVE_PLATFORMS[flow.platform] ?? NATIVE_PLATFORMS.android;
  const caps = {
    platformName: platform.platformName,
    'appium:automationName': flow.automationName || platform.defaultAutomation,
    'appium:deviceName': flow.deviceName,
  };
  if (flow.platformVersion) caps['appium:platformVersion'] = flow.platformVersion;
  if (flow.app) caps['appium:app'] = flow.app;
  if (flow.extraCaps && typeof flow.extraCaps === 'object') Object.assign(caps, flow.extraCaps);

  // Vendor options para device clouds (best-effort; extraCaps puede overridear).
  if (provider.type === 'browserstack') {
    caps['bstack:options'] = { userName: provider.username, deviceName: flow.deviceName, ...(flow.platformVersion ? { osVersion: flow.platformVersion } : {}), ...(caps['bstack:options'] || {}) };
  } else if (provider.type === 'saucelabs') {
    caps['sauce:options'] = { ...(caps['sauce:options'] || {}) };
  }
  return caps;
}

async function runStep(endpoint, sessionId, step, ctx) {
  const action = step.action;
  const value = step.value ?? '';
  const strategy = step.strategy || DEFAULT_NATIVE_STRATEGY;
  const sel = step.selector ?? '';
  const t = NATIVE_STEP_TIMEOUT_MS;
  const find = () => findElement(endpoint, sessionId, strategy, sel, t);

  switch (action) {
    case NATIVE_ACTIONS.TAP: {
      const el = await find();
      await clickElement(endpoint, sessionId, el, t);
      return { status: FLOW_STEP_STATUS.PASSED, message: 'Tap OK' };
    }
    case NATIVE_ACTIONS.TYPE: {
      const el = await find();
      await sendKeys(endpoint, sessionId, el, value, t);
      return { status: FLOW_STEP_STATUS.PASSED, message: `Escribió "${value}"` };
    }
    case NATIVE_ACTIONS.CLEAR: {
      const el = await find();
      await clearElement(endpoint, sessionId, el, t);
      return { status: FLOW_STEP_STATUS.PASSED, message: 'Campo limpiado' };
    }
    case NATIVE_ACTIONS.BACK:
      await goBack(endpoint, sessionId, t);
      return { status: FLOW_STEP_STATUS.PASSED, message: 'Back OK' };
    case NATIVE_ACTIONS.PRESS_KEY: {
      const key = String(value).trim().toLowerCase();
      const keycode = ANDROID_KEYCODES[key] ?? (Number.isInteger(Number(value)) ? Number(value) : null);
      if (keycode == null) return { status: FLOW_STEP_STATUS.FAILED, message: `Keycode no reconocido: "${value}"` };
      await pressKeycode(endpoint, sessionId, keycode, t);
      return { status: FLOW_STEP_STATUS.PASSED, message: `Tecla ${value} (keycode ${keycode})` };
    }
    case NATIVE_ACTIONS.SWIPE: {
      const rect = await getWindowRect(endpoint, sessionId, t);
      const { from, to } = swipeCoords(String(value).trim().toLowerCase(), rect);
      await performSwipe(endpoint, sessionId, from, to, t);
      return { status: FLOW_STEP_STATUS.PASSED, message: `Swipe ${value}` };
    }
    case NATIVE_ACTIONS.WAIT: {
      const ms = Math.min(Math.max(Number(value) || 0, 0), MAX_WAIT_MS);
      await ctx?.checkCancellation?.();
      await new Promise((r) => setTimeout(r, ms));
      return { status: FLOW_STEP_STATUS.PASSED, message: `Esperó ${ms}ms` };
    }
    case NATIVE_ACTIONS.WAIT_FOR: {
      const deadline = Date.now() + t;
      // eslint-disable-next-line no-await-in-loop
      while (Date.now() < deadline) {
        await ctx?.checkCancellation?.();
        try {
          // eslint-disable-next-line no-await-in-loop
          await findElement(endpoint, sessionId, strategy, sel, WAIT_FOR_POLL_MS + 800);
          return { status: FLOW_STEP_STATUS.PASSED, message: 'Elemento apareció' };
        } catch {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, WAIT_FOR_POLL_MS));
        }
      }
      return { status: FLOW_STEP_STATUS.FAILED, message: `No apareció "${sel}" en ${t}ms` };
    }
    case NATIVE_ACTIONS.ASSERT_VISIBLE: {
      try {
        const el = await find();
        const shown = await isElementDisplayed(endpoint, sessionId, el, t);
        return shown
          ? { status: FLOW_STEP_STATUS.PASSED, message: 'Está visible ✓' }
          : { status: FLOW_STEP_STATUS.FAILED, message: `Encontrado pero no visible: "${sel}"` };
      } catch {
        return { status: FLOW_STEP_STATUS.FAILED, message: `No se encontró "${sel}"` };
      }
    }
    case NATIVE_ACTIONS.ASSERT_NOT_VISIBLE: {
      try {
        const el = await findElement(endpoint, sessionId, strategy, sel, 3_000);
        const shown = await isElementDisplayed(endpoint, sessionId, el, t);
        return shown
          ? { status: FLOW_STEP_STATUS.FAILED, message: `Sigue visible: "${sel}"` }
          : { status: FLOW_STEP_STATUS.PASSED, message: 'No visible ✓' };
      } catch {
        return { status: FLOW_STEP_STATUS.PASSED, message: 'Ausente ✓' };
      }
    }
    case NATIVE_ACTIONS.ASSERT_TEXT: {
      const el = await find();
      const txt = await getElementText(endpoint, sessionId, el, t);
      const ok = String(txt).toLowerCase().includes(String(value).toLowerCase());
      return ok
        ? { status: FLOW_STEP_STATUS.PASSED, message: `Texto contiene "${value}" ✓` }
        : { status: FLOW_STEP_STATUS.FAILED, message: `Texto "${String(txt).slice(0, 120)}" no contiene "${value}"` };
    }
    default:
      return { status: FLOW_STEP_STATUS.FAILED, message: `Acción no soportada: ${action}` };
  }
}

function swipeCoords(direction, rect) {
  const w = rect.width || 1080;
  const h = rect.height || 1920;
  const cx = w / 2;
  const cy = h / 2;
  switch (direction) {
    case 'up': return { from: { x: cx, y: h * 0.7 }, to: { x: cx, y: h * 0.3 } };
    case 'down': return { from: { x: cx, y: h * 0.3 }, to: { x: cx, y: h * 0.7 } };
    case 'left': return { from: { x: w * 0.7, y: cy }, to: { x: w * 0.3, y: cy } };
    case 'right':
    default: return { from: { x: w * 0.3, y: cy }, to: { x: w * 0.7, y: cy } };
  }
}

/**
 * Corre un NativeFlow.
 * @param {{ flow, provider, accessKey, ctx, onStep, onProgress }} args
 * @returns {Promise<{ status, stepResults, summary, sessionId, errorMessage }>}
 */
export async function runNativeFlow({ flow, provider, accessKey, ctx, onStep, onProgress } = {}) {
  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  const stepResults = [];
  const startedAt = Date.now();

  let endpoint;
  try {
    endpoint = resolveEndpoint(provider, accessKey);
  } catch (err) {
    return errorResult(steps, startedAt, err instanceof AppiumError ? err.message : String(err));
  }

  onProgress?.({ message: 'Creando sesión Appium…' });
  let sessionId;
  try {
    const caps = buildCapabilities(flow, provider);
    const session = await createSession(endpoint, caps);
    sessionId = session.sessionId;
  } catch (err) {
    return errorResult(steps, startedAt, `No se pudo crear la sesión Appium: ${err.message}`);
  }

  ctx?.registerCleanup(async () => deleteSession(endpoint, sessionId));

  let aborted = false;
  try {
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (aborted) {
        const skipped = baseResult(i, step, FLOW_STEP_STATUS.SKIPPED, 'Omitido por fallo previo');
        stepResults.push(skipped);
        onStep?.(skipped);
        continue;
      }
      if (ctx?.cancelled || ctx?.signal?.aborted) break;
      await ctx?.checkCancellation?.();

      onProgress?.({ step: i + 1, total: steps.length, message: `Paso ${i + 1}/${steps.length}: ${step.action}` });

      const t0 = Date.now();
      let result;
      try {
        result = await withTimeout(runStep(endpoint, sessionId, step, ctx), NATIVE_STEP_TIMEOUT_MS + 6_000, `step ${i + 1}`);
      } catch (err) {
        result = { status: FLOW_STEP_STATUS.FAILED, message: err?.message ?? String(err) };
      }

      const record = { ...baseResult(i, step, result.status, result.message), durationMs: Date.now() - t0 };
      if (result.status === FLOW_STEP_STATUS.FAILED) {
        record.screenshotB64 = await takeScreenshot(endpoint, sessionId, 8_000).catch(() => null);
        if (!flow.continueOnError) aborted = true;
      }
      stepResults.push(record);
      onStep?.(record);
    }
  } finally {
    await deleteSession(endpoint, sessionId);
  }

  const summary = buildSummary(stepResults, steps.length, Date.now() - startedAt);
  const status = summary.failed > 0 ? FLOW_RUN_STATUS.FAILED : FLOW_RUN_STATUS.PASSED;
  return { status, stepResults, summary, sessionId, errorMessage: null };
}

function errorResult(steps, startedAt, message) {
  return {
    status: FLOW_RUN_STATUS.ERROR,
    stepResults: [],
    summary: buildSummary([], steps.length, Date.now() - startedAt),
    sessionId: null,
    errorMessage: message,
  };
}

function baseResult(index, step, status, message) {
  return {
    index,
    action: step.action,
    strategy: step.strategy ?? null,
    selector: step.selector ?? null,
    value: step.value ?? null,
    description: step.description ?? null,
    status,
    message,
  };
}

function buildSummary(stepResults, total, durationMs) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of stepResults) {
    if (r.status === FLOW_STEP_STATUS.PASSED) passed += 1;
    else if (r.status === FLOW_STEP_STATUS.FAILED) failed += 1;
    else if (r.status === FLOW_STEP_STATUS.SKIPPED) skipped += 1;
  }
  return { total, passed, failed, skipped, durationMs };
}
