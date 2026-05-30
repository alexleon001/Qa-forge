// Flow Runner determinista (diferenciador: ejecución e2e). Corre una lista
// ordenada de pasos { action, selector, value } sobre un browser Playwright real
// y devuelve pass/fail por paso + global. Reusa la infra existente: launchBrowser
// (cross-engine), buildContextOptions (device profile + storageState) y
// runLoginPreflight (sesión autenticada). Sin LLM: mismos pasos → mismo resultado.

import { buildContextOptions } from './playwright.runner.js';
import { launchBrowser, resolveEngine } from './browser.js';
import { runLoginPreflight } from './login.runner.js';
import {
  FLOW_ACTIONS,
  FLOW_RUN_STATUS,
  FLOW_STEP_STATUS,
  FLOW_STEP_TIMEOUT_MS,
  MAX_FLOW_WAIT_MS,
  RESULT_STATUS,
} from '../../../shared/constants.js';

const GOTO_TIMEOUT_MS = 25_000;
const SETTLE_TIMEOUT_MS = 5_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms en ${label}`)), ms)),
  ]);
}

/** Resuelve un value relativo contra el origin del flujo (para goto). */
function resolveUrl(value, origin) {
  try {
    return new URL(value, origin).href;
  } catch {
    return value;
  }
}

function norm(s) {
  return (s ?? '').toString().trim().toLowerCase();
}

/**
 * Ejecuta un paso. Devuelve { status, message } donde status es 'passed' o
 * 'failed'. Lanzar una excepción acá se traduce a 'failed' por el caller.
 * `locator` se construye con page.locator(selector) — acepta CSS, text=, xpath=,
 * y los selector engines de Playwright. La primera coincidencia (.first()) es la
 * que se opera.
 */
async function runStep(page, step, origin, signals) {
  const action = step.action;
  const value = step.value ?? '';
  const sel = step.selector ?? '';
  const loc = sel ? page.locator(sel).first() : null;
  const timeout = FLOW_STEP_TIMEOUT_MS;

  switch (action) {
    case FLOW_ACTIONS.GOTO: {
      await withTimeout(
        page.goto(resolveUrl(value, origin), { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS }),
        GOTO_TIMEOUT_MS + 2_000,
        'goto',
      );
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
      return { status: FLOW_STEP_STATUS.PASSED, message: `Navegó a ${page.url()}` };
    }
    case FLOW_ACTIONS.CLICK:
      await loc.click({ timeout });
      return { status: FLOW_STEP_STATUS.PASSED, message: 'Click OK' };
    case FLOW_ACTIONS.FILL:
      await loc.fill(value, { timeout });
      return { status: FLOW_STEP_STATUS.PASSED, message: `Escribió "${value}"` };
    case FLOW_ACTIONS.SELECT:
      await loc.selectOption(value, { timeout });
      return { status: FLOW_STEP_STATUS.PASSED, message: `Seleccionó "${value}"` };
    case FLOW_ACTIONS.CHECK:
      await loc.check({ timeout });
      return { status: FLOW_STEP_STATUS.PASSED, message: 'Marcado' };
    case FLOW_ACTIONS.UNCHECK:
      await loc.uncheck({ timeout });
      return { status: FLOW_STEP_STATUS.PASSED, message: 'Desmarcado' };
    case FLOW_ACTIONS.HOVER:
      await loc.hover({ timeout });
      return { status: FLOW_STEP_STATUS.PASSED, message: 'Hover OK' };
    case FLOW_ACTIONS.PRESS: {
      if (loc) await loc.press(value, { timeout });
      else await page.keyboard.press(value);
      return { status: FLOW_STEP_STATUS.PASSED, message: `Tecla "${value}"` };
    }
    case FLOW_ACTIONS.WAIT: {
      const ms = Math.min(Math.max(Number(value) || 0, 0), MAX_FLOW_WAIT_MS);
      await page.waitForTimeout(ms);
      return { status: FLOW_STEP_STATUS.PASSED, message: `Esperó ${ms}ms` };
    }
    case FLOW_ACTIONS.WAIT_FOR:
      await loc.waitFor({ state: 'visible', timeout });
      return { status: FLOW_STEP_STATUS.PASSED, message: 'Elemento visible' };
    case FLOW_ACTIONS.ASSERT_VISIBLE:
      // Una aserción fallida es un fallo de test, no un error: si el waitFor
      // timeoutea, devolvemos 'failed' con mensaje claro (no relanzamos).
      try {
        await loc.waitFor({ state: 'visible', timeout });
        return { status: FLOW_STEP_STATUS.PASSED, message: 'Está visible ✓' };
      } catch {
        return { status: FLOW_STEP_STATUS.FAILED, message: `No se encontró visible "${sel}" en ${timeout}ms` };
      }
    case FLOW_ACTIONS.ASSERT_HIDDEN:
      try {
        await loc.waitFor({ state: 'hidden', timeout });
        return { status: FLOW_STEP_STATUS.PASSED, message: 'Está oculto/ausente ✓' };
      } catch {
        return { status: FLOW_STEP_STATUS.FAILED, message: `Sigue visible "${sel}" tras ${timeout}ms` };
      }
    case FLOW_ACTIONS.ASSERT_TEXT: {
      const txt = await loc.innerText({ timeout }).catch(() => null);
      if (txt == null) return { status: FLOW_STEP_STATUS.FAILED, message: `No se pudo leer texto de "${sel}"` };
      const ok = norm(txt).includes(norm(value));
      return ok
        ? { status: FLOW_STEP_STATUS.PASSED, message: `Texto contiene "${value}" ✓` }
        : { status: FLOW_STEP_STATUS.FAILED, message: `Texto "${txt.trim().slice(0, 120)}" no contiene "${value}"` };
    }
    case FLOW_ACTIONS.ASSERT_VALUE: {
      const val = await loc.inputValue({ timeout }).catch(() => null);
      if (val == null) return { status: FLOW_STEP_STATUS.FAILED, message: `No se pudo leer value de "${sel}"` };
      const ok = norm(val) === norm(value) || norm(val).includes(norm(value));
      return ok
        ? { status: FLOW_STEP_STATUS.PASSED, message: `Value = "${val}" ✓` }
        : { status: FLOW_STEP_STATUS.FAILED, message: `Value "${val}" ≠ "${value}"` };
    }
    case FLOW_ACTIONS.ASSERT_URL: {
      const cur = page.url();
      const ok = norm(cur).includes(norm(value));
      return ok
        ? { status: FLOW_STEP_STATUS.PASSED, message: `URL contiene "${value}" ✓` }
        : { status: FLOW_STEP_STATUS.FAILED, message: `URL "${cur}" no contiene "${value}"` };
    }
    case FLOW_ACTIONS.ASSERT_TITLE: {
      const title = await page.title().catch(() => '');
      const ok = norm(title).includes(norm(value));
      return ok
        ? { status: FLOW_STEP_STATUS.PASSED, message: `Título contiene "${value}" ✓` }
        : { status: FLOW_STEP_STATUS.FAILED, message: `Título "${title}" no contiene "${value}"` };
    }
    case FLOW_ACTIONS.ASSERT_NO_CONSOLE_ERRORS: {
      const errs = signals?.consoleErrors ?? [];
      return errs.length === 0
        ? { status: FLOW_STEP_STATUS.PASSED, message: 'Sin errores de consola ✓' }
        : {
            status: FLOW_STEP_STATUS.FAILED,
            message: `${errs.length} error(es) de consola: ${errs.slice(0, 3).map((e) => e.message).join(' | ')}`,
          };
    }
    case FLOW_ACTIONS.ASSERT_NO_HTTP_ERRORS: {
      const bad = (signals?.httpErrors ?? []).filter((e) => typeof e.status !== 'number' || e.status >= 400);
      return bad.length === 0
        ? { status: FLOW_STEP_STATUS.PASSED, message: 'Sin errores HTTP ✓' }
        : {
            status: FLOW_STEP_STATUS.FAILED,
            message: `${bad.length} error(es) HTTP: ${bad.slice(0, 3).map((e) => `${e.status} ${e.url ?? ''}`).join(' | ')}`,
          };
    }
    default:
      return { status: FLOW_STEP_STATUS.FAILED, message: `Acción desconocida: ${action}` };
  }
}

/** Screenshot de la viewport en base64 (best-effort), para adjuntar a un fallo. */
async function captureFailure(page) {
  try {
    const buf = await withTimeout(page.screenshot({ type: 'png', fullPage: false }), 6_000, 'screenshot');
    return buf.toString('base64');
  } catch {
    return null;
  }
}

/**
 * Corre el flujo completo.
 * @param {{ flow, ctx, onStep, onProgress }} args
 * @returns {Promise<{ status, stepResults, summary }>}
 */
export async function runFlow({ flow, ctx, onStep, onProgress } = {}) {
  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  const origin = (() => {
    try {
      return new URL(flow.url).origin;
    } catch {
      return flow.url;
    }
  })();

  // Sesión autenticada opcional (mismo patrón que el agente exploratorio).
  let storageState;
  if (flow.loginConfig) {
    onProgress?.({ message: 'Login pre-flight…' });
    const login = await runLoginPreflight({
      loginConfig: flow.loginConfig,
      deviceProfile: flow.deviceProfile,
      browserEngine: flow.browserEngine,
    }).catch(() => null);
    if (login?.status === RESULT_STATUS.FAIL) {
      return {
        status: FLOW_RUN_STATUS.ERROR,
        stepResults: [],
        summary: { total: steps.length, passed: 0, failed: 0, skipped: steps.length, durationMs: 0 },
        errorMessage: `Login pre-flight falló: ${login.error ?? 'desconocido'}`,
      };
    }
    if (login?.status === RESULT_STATUS.PASS && login.data?.storageState) storageState = login.data.storageState;
  }

  const engine = resolveEngine(flow.browserEngine);
  const stepResults = [];
  // Señales automáticas acumuladas durante toda la corrida (v2): las leen las
  // aserciones assertNoConsoleErrors / assertNoHttpErrors y se persisten al final.
  const signals = { consoleErrors: [], httpErrors: [] };
  const startedAt = Date.now();
  let browser;

  try {
    browser = await launchBrowser(engine);
    ctx?.registerCleanup(async () => {
      try {
        await browser?.close();
      } catch {}
    });
    const context = await browser.newContext(buildContextOptions(flow.deviceProfile, storageState));
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') signals.consoleErrors.push({ message: msg.text().slice(0, 300) });
    });
    page.on('pageerror', (err) => signals.consoleErrors.push({ message: `pageerror: ${String(err?.message || err).slice(0, 300)}` }));
    page.on('response', (resp) => {
      const s = resp.status();
      if (s >= 400) signals.httpErrors.push({ status: s, url: resp.url().slice(0, 200) });
    });
    page.on('requestfailed', (req) => {
      signals.httpErrors.push({ status: 'failed', url: req.url().slice(0, 200), message: req.failure()?.errorText });
    });

    // Navegación inicial a la URL del flujo (el primer paso suele ser interactuar
    // sobre ella; si el flujo arranca con un goto explícito, este igual no molesta).
    await withTimeout(
      page.goto(flow.url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS }),
      GOTO_TIMEOUT_MS + 2_000,
      'page.goto inicial',
    );
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});

    let aborted = false;

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

      onProgress?.({ step: i + 1, total: steps.length, message: `Paso ${i + 1}/${steps.length}: ${step.action}`, url: page.url() });

      const t0 = Date.now();
      let result;
      try {
        result = await withTimeout(runStep(page, step, origin, signals), FLOW_STEP_TIMEOUT_MS + 4_000, `step ${i + 1}`);
      } catch (err) {
        result = { status: FLOW_STEP_STATUS.FAILED, message: err?.message ?? String(err) };
      }
      const durationMs = Date.now() - t0;

      const record = {
        ...baseResult(i, step, result.status, result.message),
        url: page.url(),
        durationMs,
      };

      if (result.status === FLOW_STEP_STATUS.FAILED) {
        record.screenshotB64 = await captureFailure(page);
        if (!flow.continueOnError) aborted = true;
      }

      stepResults.push(record);
      onStep?.(record);
    }
  } catch (err) {
    // Error de setup (browser/context/goto inicial) — la corrida no llegó a correr pasos.
    return {
      status: FLOW_RUN_STATUS.ERROR,
      stepResults,
      summary: buildSummary(stepResults, steps.length, Date.now() - startedAt, signals),
      signals,
      errorMessage: err?.message ?? String(err),
    };
  } finally {
    await browser?.close().catch(() => {});
  }

  const summary = buildSummary(stepResults, steps.length, Date.now() - startedAt, signals);
  const status = summary.failed > 0 ? FLOW_RUN_STATUS.FAILED : FLOW_RUN_STATUS.PASSED;
  return { status, stepResults, summary, signals, errorMessage: null };
}

function baseResult(index, step, status, message) {
  return {
    index,
    action: step.action,
    selector: step.selector ?? null,
    value: step.value ?? null,
    description: step.description ?? null,
    status,
    message,
  };
}

function buildSummary(stepResults, total, durationMs, signals) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of stepResults) {
    if (r.status === FLOW_STEP_STATUS.PASSED) passed += 1;
    else if (r.status === FLOW_STEP_STATUS.FAILED) failed += 1;
    else if (r.status === FLOW_STEP_STATUS.SKIPPED) skipped += 1;
  }
  return {
    total,
    passed,
    failed,
    skipped,
    durationMs,
    consoleErrors: signals?.consoleErrors.length ?? 0,
    httpErrors: signals?.httpErrors.length ?? 0,
  };
}
