// Convierte el trail de una sesión de AI exploratory testing en un Flow borrador
// (lista de pasos deterministas). La conversión es HEURÍSTICA y lossy: el agente
// exploratorio opera por índice de elemento (`data-qaforge-idx`, efímero) y guarda
// un `targetDesc` textual como `[3] button "Login"` o `[3] input "Email" = "qa@x"`.
// De ahí derivamos selectores best-effort (text= para clickeables, [placeholder]/
// [aria-label] para inputs) que el usuario revisa/edita en el FlowEditor antes de
// correr. Por eso el Flow resultante nace con source='exploratory'.

import { FLOW_ACTIONS, FLOW_SOURCE } from '../../../shared/constants.js';

// Parsea `[idx] tag "name"` o `[idx] tag "name" = "value"`.
const TARGET_RE = /^\[(\d+)\]\s+(\S+)\s+"([^"]*)"(?:\s+=\s+"([^"]*)")?/;

function parseTarget(targetDesc) {
  if (!targetDesc) return null;
  const m = TARGET_RE.exec(targetDesc.trim());
  if (!m) return null;
  return { idx: Number(m[1]), tag: m[2].toLowerCase(), name: m[3], value: m[4] ?? null };
}

/** Deriva un selector best-effort según el tag + nombre accesible del elemento. */
function deriveSelector(parsed) {
  const name = (parsed.name || '').trim();
  if (!name) return null;
  const inputLike = ['input', 'textarea', 'select'].includes(parsed.tag);
  if (inputLike) {
    // El name del agente suele venir de aria-label / placeholder. Probamos ambos.
    const e = cssEscapeAttr(name);
    return `[aria-label="${e}"], [placeholder="${e}"], [name="${e}"]`;
  }
  // Clickeables (a, button, [role]): selector por texto (substring de Playwright).
  return `text=${name}`;
}

function cssEscapeAttr(s) {
  return String(s).replace(/"/g, '\\"');
}

/**
 * Convierte session.steps[] → steps[] de Flow. Filtra pasos sin acción útil
 * (back/finish/error/blocked) y los que no se pueden mapear a un selector.
 */
export function stepsFromExploration(sessionSteps = []) {
  const out = [];
  for (const s of sessionSteps) {
    if (s.blocked) continue; // acciones que el agente no llegó a ejecutar
    const action = s.action;

    if (action === 'navigate') {
      // targetDesc del navigate = destino (path/URL).
      const dest = (s.targetDesc || '').trim();
      if (dest) out.push({ action: FLOW_ACTIONS.GOTO, value: dest, description: s.reasoning ?? null });
      continue;
    }
    if (action === 'click' || action === 'fill') {
      const parsed = parseTarget(s.targetDesc);
      if (!parsed) continue;
      const selector = deriveSelector(parsed);
      if (!selector) continue;
      if (action === 'fill') {
        out.push({ action: FLOW_ACTIONS.FILL, selector, value: parsed.value ?? '', description: s.reasoning ?? null });
      } else {
        out.push({ action: FLOW_ACTIONS.CLICK, selector, description: s.reasoning ?? null });
      }
      continue;
    }
    // back / finish / error → no se portan a un flow determinista.
  }
  return out;
}

/**
 * Arma el payload de un Flow borrador a partir de una ExploratorySession.
 * @returns {{ name, description, url, deviceProfile, browserEngine, source, steps }}
 */
export function flowDraftFromExploration(session) {
  const steps = stepsFromExploration(Array.isArray(session.steps) ? session.steps : []);
  return {
    name: `Exploración: ${truncate(session.goal || session.url, 60)}`,
    description: `Flujo borrador derivado de una sesión exploratoria (${steps.length} pasos). Revisá los selectores antes de correr.`,
    url: session.url,
    deviceProfile: session.deviceProfile,
    browserEngine: session.browserEngine,
    source: FLOW_SOURCE.EXPLORATORY,
    steps,
  };
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
