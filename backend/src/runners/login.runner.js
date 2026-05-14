// Pre-flight de autenticación: abre el browser, rellena un form de login y
// devuelve el storageState (cookies + localStorage) listo para reusar en los
// runners posteriores. Permite scanear áreas privadas detrás de un login.

import { devices } from 'playwright';

import { launchBrowser, resolveEngine } from './browser.js';
import { decrypt } from '../auth/crypto.js';
import {
  DEFAULTS,
  DEFAULT_DEVICE_PROFILE,
  DEVICE_PROFILES,
  RESULT_STATUS,
} from '../../../shared/constants.js';

const FILL_TIMEOUT_MS = 10_000;
const SUBMIT_WAIT_MS = 15_000;

/**
 * @param {object} opts
 * @param {object} opts.loginConfig — objeto persistido en Scan.loginConfig
 * @param {string} [opts.deviceProfile]
 * @param {import('../queue/scan.queue.js').ScanContext} [opts.scanCtx]
 * @param {(stage: string) => void} [opts.onStage]
 * @returns {Promise<{ status, data: { storageState, postLoginUrl } | null, error: string | null }>}
 */
export async function runLoginPreflight({
  loginConfig,
  deviceProfile,
  scanCtx,
  onStage,
  browserEngine,
} = {}) {
  if (!loginConfig || typeof loginConfig !== 'object') {
    return { status: RESULT_STATUS.INFO, data: null, error: null };
  }

  const {
    url: loginUrl,
    usernameSelector,
    passwordSelector,
    username,
    encryptedPassword,
    submitSelector,
    postLoginUrl,
    waitForSelector,
  } = loginConfig;

  if (!loginUrl || !usernameSelector || !passwordSelector || !username || !encryptedPassword || !submitSelector) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: 'loginConfig incompleto: faltan url/selectors/credenciales',
    };
  }

  let password;
  try {
    password = decrypt(encryptedPassword);
  } catch (err) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: `No se pudo descifrar la contraseña de login: ${err.message}`,
    };
  }

  let browser;
  try {
    onStage?.('login_preflight');
    browser = await launchBrowser(resolveEngine(browserEngine));
    scanCtx?.registerCleanup(async () => {
      try {
        await browser?.close();
      } catch {}
    });
    const context = await browser.newContext(buildContextOptions(deviceProfile));
    const page = await context.newPage();

    await page.goto(loginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULTS.PLAYWRIGHT_TIMEOUT_MS,
    });

    await page.locator(usernameSelector).first().fill(username, { timeout: FILL_TIMEOUT_MS });
    await page.locator(passwordSelector).first().fill(password, { timeout: FILL_TIMEOUT_MS });

    // El click puede disparar navegación. Esperamos en paralelo a load o a un
    // selector específico si se proveyó (más confiable para SPAs).
    const submit = page.locator(submitSelector).first();
    if (postLoginUrl) {
      await Promise.all([
        page.waitForURL(postLoginUrl, { timeout: SUBMIT_WAIT_MS }).catch(() => {}),
        submit.click(),
      ]);
    } else if (waitForSelector) {
      await Promise.all([
        page.waitForSelector(waitForSelector, { timeout: SUBMIT_WAIT_MS }).catch(() => {}),
        submit.click(),
      ]);
    } else {
      await submit.click();
      await page.waitForLoadState('networkidle', { timeout: SUBMIT_WAIT_MS }).catch(() => {});
    }

    const finalUrl = page.url();
    const storageState = await context.storageState();

    // Heurística simple: si seguimos en la URL exacta de login y no hay cookies
    // nuevas, asumimos que la submission falló (credenciales malas o captcha).
    const normalizedFinal = normalizeUrl(finalUrl);
    const normalizedLogin = normalizeUrl(loginUrl);
    const failed = normalizedFinal === normalizedLogin && (storageState.cookies?.length ?? 0) === 0;

    if (failed) {
      return {
        status: RESULT_STATUS.FAIL,
        data: null,
        error: 'Login no parece haber tenido éxito (URL sin cambios, sin cookies nuevas)',
      };
    }

    return {
      status: RESULT_STATUS.PASS,
      data: {
        storageState,
        loginUrl,
        finalUrl,
        cookieCount: storageState.cookies?.length ?? 0,
      },
      error: null,
    };
  } catch (err) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

function buildContextOptions(deviceProfileId) {
  const id =
    deviceProfileId && DEVICE_PROFILES[deviceProfileId]
      ? deviceProfileId
      : DEFAULT_DEVICE_PROFILE;
  const profile = DEVICE_PROFILES[id];
  const pwDevice = profile.playwrightDevice ? devices[profile.playwrightDevice] : null;
  if (pwDevice) {
    return {
      ...pwDevice,
      userAgent: pwDevice.userAgent || 'Mozilla/5.0 (compatible; QAForgeBot/0.1; +login)',
    };
  }
  return {
    userAgent: 'Mozilla/5.0 (compatible; QAForgeBot/0.1; +login)',
    viewport: profile.viewport,
  };
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    return `${url.origin}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return u;
  }
}
