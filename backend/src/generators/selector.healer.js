// Auto-healing de selectores (FASE diferenciadores #1). v1: solo Playwright.
// Carga la URL del scan en vivo, verifica cada selector del script con la API
// de Playwright (page.locator().count()), y para los que NO resuelven pide al
// LLM un reemplazo usando el DOM actual. Advisory: nunca sobreescribe sin que el
// usuario confirme (apply=true).

import { prisma } from '../db/client.js';
import { applyHeals, buildLocator, extractPlaywrightSelectors } from './selector.extract.js';
import { buildContextOptions } from '../runners/playwright.runner.js';
import { launchBrowser, resolveEngine } from '../runners/browser.js';
import { resolveProvider } from './providers/index.js';
import { runLoginPreflight } from '../runners/login.runner.js';
import { SCRIPT_FRAMEWORK } from '../../../shared/constants.js';

const GOTO_TIMEOUT_MS = 25_000;
const NETWORKIDLE_TIMEOUT_MS = 8_000;
const SELECTOR_TIMEOUT_MS = 4_000;

const HEAL_SYSTEM_PROMPT = `Eres un ingeniero senior de QA Automation experto en Playwright. Tu tarea es
**reparar selectores rotos** de un test E2E existente, usando el DOM ACTUAL de la
página (que cambió desde que el test se escribió).

Recibís:
- La URL bajo prueba.
- La lista de selectores que YA NO resuelven en la página (rotos).
- Un resumen del DOM actual (forms, inputs, botones, links, headings, data-testids).

Reglas:
1. Devolvé un reemplazo SOLO para los selectores rotos que recibís. El campo
   "original" debe coincidir EXACTAMENTE (carácter por carácter) con uno de los
   selectores rotos provistos.
2. El "replacement" es una expresión de locator Playwright COMPLETA, sin el
   "page." inicial. Ejemplos válidos:
   - \`getByTestId('login-submit')\`
   - \`getByRole('button', { name: 'Iniciar sesión' })\`
   - \`getByLabel('Email')\`
   - \`locator('#login-form button[type="submit"]')\`
3. Orden de preferencia para el reemplazo: data-testid → getByRole + nombre
   accesible → getByLabel/getByText → CSS estable (id, atributos semánticos).
   Evitá XPath, nth-child profundo y clases auto-generadas.
4. **Solo usá elementos presentes en el resumen del DOM actual.** No inventes
   testids, roles ni textos que no estén ahí.
5. Si para un selector roto no hay un reemplazo razonable en el DOM actual,
   OMITÍLO del array (no lo fuerces).
6. "confidence": high si el match es claro y unívoco; medium si es plausible pero
   hay ambigüedad; low si es la mejor conjetura disponible.
7. "reason": una línea en español explicando a qué elemento del DOM apunta el fix.

Devolvé ÚNICAMENTE el JSON estructurado del schema.`;

export const HEAL_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    heals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          replacement: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' },
        },
        required: ['original', 'replacement', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['heals'],
  additionalProperties: false,
});

/** Promise.race con timeout duro — los handshakes/locators pueden colgarse. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${ms}ms en ${label}`)), ms),
    ),
  ]);
}

function fail(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * @param {{ scanId: string, provider?: string|null, model?: string|null, apply?: boolean, userId?: string|null }} args
 */
export async function healScriptSelectors({
  scanId,
  provider: requestedProviderId = null,
  model: requestedModel = null,
  apply = false,
  userId = null,
} = {}) {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: { scripts: { where: { framework: SCRIPT_FRAMEWORK.PLAYWRIGHT } } },
  });
  if (!scan) throw fail('Scan no encontrado', 404, 'SCAN_NOT_FOUND');

  const script = scan.scripts[0];
  if (!script) {
    throw fail(
      'Este scan no tiene un script Playwright generado — generá los scripts primero.',
      404,
      'NO_PLAYWRIGHT_SCRIPT',
    );
  }
  if (!scan.url) throw fail('El scan no tiene URL', 409, 'NO_URL');

  const descriptors = extractPlaywrightSelectors(script.content);
  if (descriptors.length === 0) {
    return {
      report: [],
      healedContent: script.content,
      applied: false,
      healedCount: 0,
      brokenCount: 0,
      checkedCount: 0,
      provider: null,
      model: null,
    };
  }

  // Sesión autenticada si el scan la usó.
  let storageState;
  if (scan.loginConfig) {
    const login = await runLoginPreflight({
      loginConfig: scan.loginConfig, // Prisma Json → objeto ya deserializado
      deviceProfile: scan.deviceProfile,
      browserEngine: scan.browserEngine,
    }).catch(() => null);
    if (login?.status === 'pass' && login.data?.storageState) {
      storageState = login.data.storageState;
    }
  }

  const engine = resolveEngine(scan.browserEngine);
  const report = [];
  let liveSummary = null;
  let browser;
  try {
    browser = await launchBrowser(engine);
    const context = await browser.newContext(buildContextOptions(scan.deviceProfile, storageState));
    const page = await context.newPage();

    await withTimeout(
      page.goto(scan.url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS }),
      GOTO_TIMEOUT_MS + 2_000,
      'page.goto',
    );
    await page.waitForLoadState('networkidle', { timeout: NETWORKIDLE_TIMEOUT_MS }).catch(() => {});

    for (const d of descriptors) {
      const locator = buildLocator(page, d);
      if (!locator) {
        report.push({ raw: d.raw, status: 'no-verificable' });
        continue;
      }
      let count = 0;
      try {
        count = await withTimeout(locator.count(), SELECTOR_TIMEOUT_MS, `count(${d.raw})`);
      } catch {
        count = 0;
      }
      report.push({ raw: d.raw, status: count > 0 ? 'ok' : 'no-resuelto' });
    }

    liveSummary = await captureLiveSummary(page).catch(() => null);
  } catch (err) {
    throw fail(
      `No se pudo cargar la URL para verificar selectores: ${err?.message ?? err}`,
      502,
      'HEAL_PAGE_LOAD_FAILED',
    );
  } finally {
    await browser?.close().catch(() => {});
  }

  const broken = report.filter((r) => r.status === 'no-resuelto');
  const checkedCount = report.filter((r) => r.status !== 'no-verificable').length;

  // Nada roto → no llamamos al LLM (ahorro de tokens).
  if (broken.length === 0) {
    return {
      report,
      healedContent: script.content,
      applied: false,
      healedCount: 0,
      brokenCount: 0,
      checkedCount,
      provider: null,
      model: null,
    };
  }

  const { provider, apiKey } = await resolveProvider({ requestedId: requestedProviderId, userId });
  const result = await provider.generateStructured({
    system: HEAL_SYSTEM_PROMPT,
    user: buildHealUserMessage({
      url: scan.url,
      brokenRaws: broken.map((b) => b.raw),
      liveSummary,
    }),
    schema: HEAL_OUTPUT_SCHEMA,
    model: requestedModel,
    apiKey,
  });

  const heals = Array.isArray(result.parsed?.heals) ? result.parsed.heals : [];
  // Enriquecer el reporte con los fixes propuestos.
  for (const h of heals) {
    const entry = report.find((r) => r.raw === h.original && r.status === 'no-resuelto');
    if (entry) {
      entry.status = 'curado';
      entry.replacement = h.replacement;
      entry.confidence = h.confidence;
      entry.reason = h.reason;
    }
  }

  const healedContent = applyHeals(script.content, heals);
  let applied = false;
  if (apply && healedContent !== script.content) {
    await prisma.script.update({ where: { id: script.id }, data: { content: healedContent } });
    applied = true;
  }

  return {
    report,
    healedContent,
    applied,
    healedCount: heals.length,
    brokenCount: broken.length,
    checkedCount,
    provider: result.providerId,
    model: result.model,
    usage: result.usage,
  };
}

/** Resumen del DOM actual para que el LLM proponga reemplazos basados en lo real. */
function captureLiveSummary(page) {
  return page.evaluate(() => {
    const txt = (el, n = 80) => (el.textContent || '').trim().slice(0, n);
    const meta = {};
    for (const el of document.querySelectorAll('meta')) {
      const name = el.getAttribute('name') || el.getAttribute('property');
      const content = el.getAttribute('content');
      if (name && content) meta[name] = content;
    }
    return {
      title: document.title,
      meta: {
        description: meta.description,
        'og:title': meta['og:title'],
      },
      testIds: Array.from(document.querySelectorAll('[data-testid]'))
        .slice(0, 60)
        .map((e) => e.getAttribute('data-testid')),
      forms: Array.from(document.querySelectorAll('form'))
        .slice(0, 10)
        .map((form) => ({
          id: form.id || null,
          action: form.getAttribute('action') || null,
          inputs: Array.from(form.querySelectorAll('input, textarea, select'))
            .slice(0, 30)
            .map((i) => ({
              tag: i.tagName.toLowerCase(),
              type: i.getAttribute('type') || null,
              name: i.getAttribute('name') || null,
              id: i.id || null,
              placeholder: i.getAttribute('placeholder') || null,
              ariaLabel: i.getAttribute('aria-label') || null,
            })),
        })),
      buttons: Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a[role="button"]'))
        .slice(0, 40)
        .map((b) => ({
          text: txt(b, 60) || b.getAttribute('value') || null,
          ariaLabel: b.getAttribute('aria-label') || null,
          id: b.id || null,
          testId: b.getAttribute('data-testid') || null,
        })),
      links: Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 40)
        .map((a) => ({ text: txt(a), href: a.getAttribute('href') })),
      headings: {
        h1: Array.from(document.querySelectorAll('h1')).slice(0, 5).map((h) => txt(h)),
        h2: Array.from(document.querySelectorAll('h2')).slice(0, 10).map((h) => txt(h)),
      },
    };
  });
}

function buildHealUserMessage({ url, brokenRaws, liveSummary }) {
  return [
    `URL bajo prueba: ${url}`,
    '',
    'Selectores ROTOS a reparar (el "original" del heal debe matchear uno de estos exactamente):',
    '```',
    brokenRaws.join('\n'),
    '```',
    '',
    'Resumen del DOM ACTUAL de la página:',
    '```json',
    JSON.stringify(liveSummary ?? { note: 'No se pudo resumir el DOM' }, null, 2),
    '```',
    '',
    'Proponé los reemplazos según el schema JSON.',
  ].join('\n');
}
