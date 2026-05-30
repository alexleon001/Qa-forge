// AI exploratory testing (diferenciador #2). Un agente de IA maneja un browser
// Playwright de forma autónoma: observa el DOM (texto), decide la próxima acción
// (click/fill/navegar), la ejecuta de forma segura (same-origin, no destructiva),
// y acumula señales automáticas (errores de consola/HTTP). Al final, una pasada
// del LLM consolida los hallazgos. Provider-agnóstico (cada paso es texto).

import { buildContextOptions } from '../runners/playwright.runner.js';
import { launchBrowser, resolveEngine } from '../runners/browser.js';
import { resolveProvider } from '../generators/providers/index.js';
import { runLoginPreflight } from '../runners/login.runner.js';
import { EXPLORE_ACTIONS, FINDING_SEVERITY } from '../../../shared/constants.js';

const GOTO_TIMEOUT_MS = 25_000;
const ACTION_TIMEOUT_MS = 8_000;
const SETTLE_TIMEOUT_MS = 5_000;
const MAX_ELEMENTS = 80;

const ACTION_SYSTEM_PROMPT = `Eres un tester exploratorio experto. Estás manejando un navegador real sobre un
sitio web, paso a paso, buscando bugs y problemas de usabilidad. En cada turno
recibís el estado actual de la página (URL, título, lista NUMERADA de elementos
interactivos visibles, errores de consola/red recientes, historial de tus acciones)
y elegís UNA acción.

Acciones posibles:
- "click": clickear un elemento. Requiere "targetIdx" (el índice de la lista).
- "fill": escribir en un input. Requiere "targetIdx" + "value" (dato de prueba realista).
- "navigate": ir a una ruta del MISMO sitio. Requiere "value" (URL o path same-origin).
- "back": volver atrás.
- "finish": terminar la exploración (cuando ya cubriste lo relevante o no hay más que probar).

Reglas CRÍTICAS de seguridad (obligatorias):
- NUNCA hagas acciones destructivas o irreversibles: cerrar sesión/logout, borrar/
  eliminar, comprar/pagar, confirmar pedidos, enviar mensajes/emails reales, cambiar
  contraseñas. Si un elemento parece hacer eso, evitalo.
- NO sigas links externos (otro dominio). Quedate dentro del sitio.
- Explorá variado: navegá secciones, abrí menús, probá formularios con datos válidos
  e inválidos para ver validaciones. No repitas la misma acción en loop.

Si en el paso actual notás un problema (error JS, página rota, link roto, validación
ausente, comportamiento inesperado, UX confusa), reportalo en "finding".

"reasoning": una frase corta en español de por qué elegís esa acción.
Devolvé SOLO el JSON del schema.`;

const ACTION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    action: { type: 'string', enum: [...EXPLORE_ACTIONS] },
    targetIdx: { type: 'integer' },
    value: { type: 'string' },
    finding: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: [...FINDING_SEVERITY] },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
      },
      required: ['severity', 'title', 'description', 'category'],
      additionalProperties: false,
    },
  },
  required: ['reasoning', 'action'],
  additionalProperties: false,
});

const FINDINGS_SYSTEM_PROMPT = `Eres un QA senior. Recibís el trail completo de una sesión de testing exploratorio
(las acciones que tomó el agente) y las señales automáticas recolectadas (errores de
consola JS, respuestas HTTP de error, requests fallidos). Consolidá una lista de
HALLAZGOS accionables y sin duplicar.

Cada hallazgo: severity (critical|high|medium|low|info), title (corto), description
(qué pasa y por qué importa, en español), category (functional|security|performance|
accessibility|seo|ux), evidence (referencia al paso o al error que lo respalda).
Si no hay nada relevante, devolvé "findings" vacío. Devolvé SOLO el JSON del schema.`;

const FINDINGS_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: [...FINDING_SEVERITY] },
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['severity', 'title', 'description', 'category', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
});

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms en ${label}`)), ms)),
  ]);
}

function sameOrigin(candidate, origin) {
  try {
    return new URL(candidate, origin).origin === origin;
  } catch {
    return false;
  }
}

/** (Re)taggea los elementos interactivos visibles y los devuelve indexados. */
function observe(page) {
  return page.evaluate((max) => {
    document.querySelectorAll('[data-qaforge-idx]').forEach((e) => e.removeAttribute('data-qaforge-idx'));
    const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
    const out = [];
    let i = 0;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const visible = r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      if (!visible) continue;
      if (el.getAttribute('type') === 'hidden' || el.disabled) continue;
      el.setAttribute('data-qaforge-idx', String(i));
      const tag = el.tagName.toLowerCase();
      out.push({
        idx: i,
        tag,
        type: el.getAttribute('type') || null,
        role: el.getAttribute('role') || null,
        name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('value') || '').trim().slice(0, 80),
        href: tag === 'a' ? el.getAttribute('href') : null,
        target: el.getAttribute('target') || null,
      });
      i += 1;
      if (i >= max) break;
    }
    return out;
  }, MAX_ELEMENTS);
}

/** Dato de prueba sintético cuando el LLM no provee "value" para un fill. */
function synthValue(el) {
  const t = (el?.type || '').toLowerCase();
  if (t === 'email') return 'qa.test@example.com';
  if (t === 'password') return 'Test1234!';
  if (t === 'tel') return '+15555550123';
  if (t === 'number') return '42';
  if (t === 'url') return 'https://example.com';
  if (t === 'date') return '2026-01-01';
  return 'QA Forge test';
}

/**
 * @param {{ session, ctx, onStep, onFinding, onProgress }} args
 * @returns {Promise<{ steps, findings, summary, provider, model }>}
 */
export async function runExploration({ session, ctx, onStep, onFinding, onProgress } = {}) {
  const origin = new URL(session.url).origin;
  const { provider, apiKey } = await resolveProvider({
    requestedId: session.provider ?? null,
    userId: session.userId,
  });

  // Sesión autenticada si la sesión define loginConfig.
  let storageState;
  if (session.loginConfig) {
    const login = await runLoginPreflight({
      loginConfig: session.loginConfig,
      deviceProfile: session.deviceProfile,
      browserEngine: session.browserEngine,
    }).catch(() => null);
    if (login?.status === 'pass' && login.data?.storageState) storageState = login.data.storageState;
  }

  const engine = resolveEngine(session.browserEngine);
  const steps = [];
  const inlineFindings = [];
  const consoleErrors = [];
  const httpErrors = [];
  const pagesVisited = new Set();
  let lastConsoleLen = 0;
  let lastHttpLen = 0;
  let usedModel = null;

  let browser;
  try {
    browser = await launchBrowser(engine);
    ctx?.registerCleanup(async () => {
      try {
        await browser?.close();
      } catch {}
    });
    const context = await browser.newContext(buildContextOptions(session.deviceProfile, storageState));

    // Popups (target=_blank / window.open): los cerramos para no perder el control.
    context.on('page', (popup) => {
      popup.close().catch(() => {});
      httpErrors.push({ kind: 'popup', message: 'Se bloqueó un popup/ventana nueva' });
    });

    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push({ message: msg.text().slice(0, 300) });
    });
    page.on('pageerror', (err) => consoleErrors.push({ message: `pageerror: ${String(err?.message || err).slice(0, 300)}` }));
    page.on('response', (resp) => {
      const s = resp.status();
      if (s >= 400) httpErrors.push({ status: s, url: resp.url().slice(0, 200) });
    });
    page.on('requestfailed', (req) => {
      httpErrors.push({ status: 'failed', url: req.url().slice(0, 200), message: req.failure()?.errorText });
    });

    await withTimeout(
      page.goto(session.url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS }),
      GOTO_TIMEOUT_MS + 2_000,
      'page.goto inicial',
    );
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
    pagesVisited.add(page.url());

    for (let n = 1; n <= session.maxSteps; n += 1) {
      if (ctx?.cancelled || ctx?.signal?.aborted) break;
      await ctx?.checkCancellation?.();

      const els = await observe(page).catch(() => []);
      const newConsole = consoleErrors.slice(lastConsoleLen);
      const newHttp = httpErrors.slice(lastHttpLen);
      lastConsoleLen = consoleErrors.length;
      lastHttpLen = httpErrors.length;

      onProgress?.({ step: n, total: session.maxSteps, message: `Paso ${n}/${session.maxSteps} — decidiendo acción`, url: page.url() });

      let decision;
      try {
        const result = await provider.generateStructured({
          system: ACTION_SYSTEM_PROMPT,
          user: buildActionMessage({ session, n, url: page.url(), title: await page.title().catch(() => ''), els, newConsole, newHttp, history: steps }),
          schema: ACTION_SCHEMA,
          model: session.model ?? null,
          apiKey,
        });
        usedModel = result.model;
        decision = result.parsed ?? {};
      } catch (err) {
        // Si el LLM falla, cortamos la sesión pero conservamos lo recolectado.
        steps.push({ n, action: 'error', targetDesc: null, reasoning: `LLM error: ${err?.message ?? err}`, url: page.url(), newErrors: [...newConsole, ...newHttp] });
        break;
      }

      const action = EXPLORE_ACTIONS.includes(decision.action) ? decision.action : 'finish';
      const target = decision.targetIdx != null ? els.find((e) => e.idx === decision.targetIdx) : null;

      // Hallazgo inline propuesto por el agente.
      if (decision.finding && decision.finding.title) {
        const f = { id: `f-step-${n}`, ...decision.finding, evidence: `Paso ${n}` };
        inlineFindings.push(f);
        onFinding?.(f);
      }

      let blocked = null;
      let targetDesc = target ? `[${target.idx}] ${target.tag} "${target.name}"` : null;

      if (action === 'finish') {
        steps.push({ n, action, targetDesc: null, reasoning: decision.reasoning ?? null, url: page.url(), newErrors: [] });
        onStep?.(steps[steps.length - 1]);
        break;
      }

      try {
        if (action === 'click') {
          if (!target) {
            blocked = 'targetIdx inválido';
          } else if (target.tag === 'a' && (target.target === '_blank' || (target.href && !sameOrigin(target.href, origin)))) {
            blocked = 'link externo / nueva pestaña (omitido)';
          } else {
            await withTimeout(
              page.locator(`[data-qaforge-idx="${target.idx}"]`).first().click({ timeout: ACTION_TIMEOUT_MS }),
              ACTION_TIMEOUT_MS + 1_000,
              'click',
            );
          }
        } else if (action === 'fill') {
          if (!target) {
            blocked = 'targetIdx inválido';
          } else {
            const value = decision.value || synthValue(target);
            await withTimeout(
              page.locator(`[data-qaforge-idx="${target.idx}"]`).first().fill(value, { timeout: ACTION_TIMEOUT_MS }),
              ACTION_TIMEOUT_MS + 1_000,
              'fill',
            );
            targetDesc = `${targetDesc} = "${value}"`;
          }
        } else if (action === 'navigate') {
          const dest = decision.value;
          if (!dest || !sameOrigin(dest, origin)) {
            blocked = 'navigate fuera del origin (omitido)';
          } else {
            await withTimeout(
              page.goto(new URL(dest, origin).href, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS }),
              GOTO_TIMEOUT_MS + 2_000,
              'navigate',
            );
            targetDesc = dest;
          }
        } else if (action === 'back') {
          await page.goBack({ timeout: ACTION_TIMEOUT_MS }).catch(() => {});
        }

        await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});

        // Guardrail duro: si terminamos fuera del origin, volvemos.
        if (!sameOrigin(page.url(), origin)) {
          blocked = (blocked ? `${blocked}; ` : '') + 'navegó fuera del origin → volví atrás';
          await page.goBack({ timeout: ACTION_TIMEOUT_MS }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
        }
      } catch (err) {
        blocked = `acción falló: ${err?.message ?? err}`;
      }

      pagesVisited.add(page.url());
      const stepErrors = [...consoleErrors.slice(lastConsoleLen), ...httpErrors.slice(lastHttpLen)];
      lastConsoleLen = consoleErrors.length;
      lastHttpLen = httpErrors.length;
      const step = { n, action, targetDesc, reasoning: decision.reasoning ?? null, url: page.url(), blocked, newErrors: stepErrors };
      steps.push(step);
      onStep?.(step);
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  // Señales automáticas como findings de oficio.
  const autoFindings = buildAutoFindings(consoleErrors, httpErrors);

  // Pasada de consolidación por el LLM (best-effort).
  let llmFindings = [];
  try {
    onProgress?.({ message: 'Consolidando hallazgos' });
    const result = await provider.generateStructured({
      system: FINDINGS_SYSTEM_PROMPT,
      user: buildFindingsMessage({ session, steps, consoleErrors, httpErrors }),
      schema: FINDINGS_SCHEMA,
      model: session.model ?? null,
      apiKey,
    });
    usedModel = result.model ?? usedModel;
    llmFindings = (result.parsed?.findings ?? []).map((f, i) => ({ id: `f-llm-${i}`, ...f }));
  } catch {
    // sin consolidación: nos quedamos con inline + auto
  }

  const findings = dedupeFindings([...autoFindings, ...inlineFindings, ...llmFindings]);
  const summary = {
    stepsTaken: steps.length,
    pagesVisited: pagesVisited.size,
    consoleErrors: consoleErrors.length,
    httpErrors: httpErrors.length,
    findingsBySeverity: countBySeverity(findings),
  };

  return { steps, findings, summary, provider: provider.id, model: usedModel };
}

function buildActionMessage({ session, n, url, title, els, newConsole, newHttp, history }) {
  const elementList = els.map((e) => {
    const bits = [`[${e.idx}] ${e.tag}`];
    if (e.type) bits.push(`type=${e.type}`);
    if (e.role) bits.push(`role=${e.role}`);
    if (e.name) bits.push(`"${e.name}"`);
    if (e.href) bits.push(`href=${e.href}`);
    return bits.join(' ');
  });
  const recentHistory = history.slice(-6).map((s) => `  ${s.n}. ${s.action} ${s.targetDesc ?? ''}${s.blocked ? ` (bloqueado: ${s.blocked})` : ''}`);
  return [
    session.goal ? `Objetivo de la exploración: ${session.goal}` : 'Sin objetivo específico: explorá la funcionalidad principal del sitio.',
    `Paso ${n} de ${session.maxSteps}.`,
    `URL actual: ${url}`,
    `Título: ${title}`,
    '',
    `Elementos interactivos visibles (${els.length}):`,
    elementList.length ? elementList.join('\n') : '  (ninguno detectado)',
    '',
    newConsole.length ? `Errores de consola nuevos:\n${newConsole.map((e) => `  - ${e.message}`).join('\n')}` : 'Sin errores de consola nuevos.',
    newHttp.length ? `Errores HTTP nuevos:\n${newHttp.map((e) => `  - ${e.status} ${e.url ?? e.message ?? ''}`).join('\n')}` : 'Sin errores HTTP nuevos.',
    '',
    recentHistory.length ? `Tus últimas acciones:\n${recentHistory.join('\n')}` : 'Primer paso.',
    '',
    'Elegí la próxima acción según el schema.',
  ].join('\n');
}

function buildFindingsMessage({ session, steps, consoleErrors, httpErrors }) {
  return [
    `URL explorada: ${session.url}`,
    session.goal ? `Objetivo: ${session.goal}` : '',
    '',
    'Trail de acciones:',
    '```',
    steps.map((s) => `${s.n}. ${s.action} ${s.targetDesc ?? ''} → ${s.url}${s.blocked ? ` [${s.blocked}]` : ''}`).join('\n'),
    '```',
    '',
    `Errores de consola JS (${consoleErrors.length}):`,
    consoleErrors.slice(0, 30).map((e) => `  - ${e.message}`).join('\n') || '  ninguno',
    '',
    `Errores HTTP / requests fallidos (${httpErrors.length}):`,
    httpErrors.slice(0, 30).map((e) => `  - ${e.status} ${e.url ?? e.message ?? ''}`).join('\n') || '  ninguno',
    '',
    'Consolidá los hallazgos según el schema.',
  ].filter(Boolean).join('\n');
}

/** Errores de consola/HTTP como hallazgos automáticos (sin pasar por el LLM). */
function buildAutoFindings(consoleErrors, httpErrors) {
  const out = [];
  if (consoleErrors.length > 0) {
    out.push({
      id: 'f-auto-console',
      severity: 'medium',
      title: `${consoleErrors.length} error(es) de consola JS`,
      description: `Se detectaron errores en la consola del navegador durante la exploración. Primeros: ${consoleErrors.slice(0, 3).map((e) => e.message).join(' | ')}`,
      category: 'functional',
      evidence: 'console',
    });
  }
  const serverErrors = httpErrors.filter((e) => typeof e.status === 'number' && e.status >= 500);
  if (serverErrors.length > 0) {
    out.push({
      id: 'f-auto-http5xx',
      severity: 'high',
      title: `${serverErrors.length} respuesta(s) HTTP 5xx`,
      description: `El servidor devolvió errores 5xx: ${serverErrors.slice(0, 3).map((e) => `${e.status} ${e.url}`).join(' | ')}`,
      category: 'functional',
      evidence: 'http',
    });
  }
  return out;
}

function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const key = (f.title || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function countBySeverity(findings) {
  const counts = {};
  for (const sev of FINDING_SEVERITY) counts[sev] = 0;
  for (const f of findings) if (counts[f.severity] != null) counts[f.severity] += 1;
  return counts;
}
