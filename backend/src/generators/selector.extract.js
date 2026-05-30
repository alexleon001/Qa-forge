// Extracción y reconstrucción de selectores de un script Playwright (auto-healing).
// Parsea los patrones de locator más comunes con regex (sin eval), los reconstruye
// con la API real de Playwright para poder verificarlos en vivo, y aplica los
// reemplazos curados al texto del script.

/**
 * Patrones de locator soportados. Lo que no matchea uno de estos NO se extrae
 * (queda fuera del healing — transparente, no se inventa nada).
 *
 * - getByRole('button', { name: 'X' })   → role + name (string)
 * - getByTestId('x') / getByText('x') / getByLabel('x') / getByPlaceholder('x')
 * - locator('css')
 */
const SIMPLE_KINDS = ['getByTestId', 'getByText', 'getByLabel', 'getByPlaceholder', 'locator'];

// .getByRole('role', { ...options }?)
const ROLE_RE = /\.getByRole\(\s*(['"`])(.*?)\1\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
// .getByTestId('x') | .getByText('x') | .getByLabel('x') | .getByPlaceholder('x') | .locator('css')
const SIMPLE_RE = new RegExp(
  `\\.(${SIMPLE_KINDS.join('|')})\\(\\s*(['"\`])(.*?)\\2\\s*(?:,\\s*\\{[^}]*\\})?\\s*\\)`,
  'g',
);
// name: 'X' dentro de las options de getByRole (solo string — regex /.../ no se parsea)
const NAME_RE = /name\s*:\s*(['"`])(.*?)\1/;

/**
 * Extrae los selectores únicos de un script Playwright.
 * @param {string} content
 * @returns {Array<{ raw, kind, value?, role?, name?, unverifiable?: boolean }>}
 *   `raw` es la expresión sin el punto inicial (p.ej. `getByRole('button', { name: 'Login' })`),
 *   usada para el reemplazo textual y como id en el reporte.
 */
export function extractPlaywrightSelectors(content) {
  if (!content || typeof content !== 'string') return [];
  const byRaw = new Map();

  for (const m of content.matchAll(ROLE_RE)) {
    const raw = m[0].slice(1); // quitar el '.' inicial
    if (byRaw.has(raw)) continue;
    const role = m[2];
    const options = m[3] ?? '';
    const nameMatch = options ? options.match(NAME_RE) : null;
    // Tenía options pero el name no es un string parseable (p.ej. regex) → no verificable.
    const unverifiable = Boolean(options.trim()) && !nameMatch && /name\s*:/.test(options);
    byRaw.set(raw, {
      raw,
      kind: 'getByRole',
      role,
      name: nameMatch ? nameMatch[2] : undefined,
      unverifiable,
    });
  }

  for (const m of content.matchAll(SIMPLE_RE)) {
    const raw = m[0].slice(1);
    if (byRaw.has(raw)) continue;
    byRaw.set(raw, { raw, kind: m[1], value: m[3] });
  }

  return Array.from(byRaw.values());
}

/**
 * Reconstruye un locator de Playwright a partir de un descriptor, usando la API
 * real (NO eval). Devuelve null si el patrón no es reconstruible.
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof extractPlaywrightSelectors>[number]} d
 */
export function buildLocator(page, d) {
  if (!d || d.unverifiable) return null;
  switch (d.kind) {
    case 'locator':
      return d.value != null ? page.locator(d.value) : null;
    case 'getByTestId':
      return d.value != null ? page.getByTestId(d.value) : null;
    case 'getByText':
      return d.value != null ? page.getByText(d.value) : null;
    case 'getByLabel':
      return d.value != null ? page.getByLabel(d.value) : null;
    case 'getByPlaceholder':
      return d.value != null ? page.getByPlaceholder(d.value) : null;
    case 'getByRole':
      if (!d.role) return null;
      return d.name != null
        ? page.getByRole(d.role, { name: d.name })
        : page.getByRole(d.role);
    default:
      return null;
  }
}

/**
 * Aplica los reemplazos curados al contenido del script (string replace global
 * por la expresión `original`). Ignora heals vacíos o sin cambio real.
 */
export function applyHeals(content, heals) {
  let out = content;
  for (const h of heals ?? []) {
    if (!h?.original || !h?.replacement || h.original === h.replacement) continue;
    out = out.split(h.original).join(h.replacement);
  }
  return out;
}
