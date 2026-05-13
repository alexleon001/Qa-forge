// Orquestador del Script Generator. La lógica de cada LLM vive en providers/.
// Este archivo: arma el prompt, llama al provider elegido, persiste resultados.

import { parseDetails, prisma } from '../db/client.js';
import {
  SCRIPT_FRAMEWORK,
  SCRIPT_LANGUAGE,
} from '../../../shared/constants.js';
import { resolveProvider } from './providers/index.js';

const FRAMEWORKS_META = Object.freeze([
  { key: SCRIPT_FRAMEWORK.PLAYWRIGHT, language: SCRIPT_LANGUAGE.TYPESCRIPT, label: 'Playwright + TypeScript' },
  { key: SCRIPT_FRAMEWORK.CYPRESS, language: SCRIPT_LANGUAGE.JAVASCRIPT, label: 'Cypress + JavaScript' },
  { key: SCRIPT_FRAMEWORK.SELENIUM, language: SCRIPT_LANGUAGE.PYTHON, label: 'Selenium + Python' },
]);

const SYSTEM_PROMPT = `Eres un ingeniero senior de QA Automation con 10+ años de experiencia
escribiendo suites E2E en Playwright, Cypress y Selenium para sitios reales en producción.

Tu tarea: generar **tres archivos de tests E2E** (uno por framework), basados en el DOM
analizado y la URL recibida. Cada archivo debe contener una **suite completa**, no un
test trivial de smoke.

═══════════════════════════════════════════════════════════════════════
COBERTURA OBJETIVO (por archivo)
═══════════════════════════════════════════════════════════════════════

Cada archivo debe incluir mínimo **6-10 tests** cubriendo:

1. **Smoke test**: la página carga (HTTP 200) y muestra el title esperado.
2. **Navegación**: clickear links internos clave del header/menú y verificar que la
   URL cambia y la nueva página carga sin error.
3. **Forms detectados (uno por uno)**:
   - Happy path: rellenar todos los campos con datos válidos y submitear; verificar
     mensaje de éxito o redirección esperada.
   - Validación: dejar campos requeridos vacíos; verificar mensajes de error.
   - Si hay un campo email: probar formato inválido y verificar el mensaje.
4. **Si parece form de login**: incluir test con credenciales inválidas que verifique
   el mensaje de error y que NO se redirija al dashboard.
5. **Si hay buscador**: búsqueda con término real + búsqueda sin resultados.
6. **Si parece ecommerce**: ir a un producto, agregar al carrito, verificar que el
   contador del carrito incrementa.
7. **Verificación de meta tags**: title, meta description, OG tags presentes.
8. **Links rotos**: chequear que los principales links internos respondan 2xx
   (con \`request.head()\` o equivalente).

═══════════════════════════════════════════════════════════════════════
CALIDAD DEL CÓDIGO
═══════════════════════════════════════════════════════════════════════

1. **Selectores robustos** (en orden de preferencia):
   a. \`data-testid\` (si existe en el DOM)
   b. \`getByRole\` + nombre accesible (Playwright/Cypress)
   c. Texto visible exacto
   d. CSS estable (id, clase semántica)
   ✘ Evitar: XPath absoluto, nth-child profundo, clases auto-generadas tipo \`css-1ab2c\`.

2. **Async/await siempre**, nunca callbacks ni promesas encadenadas con \`.then()\`.

3. **Waits explícitos**: \`expect(locator).toBeVisible()\`, \`page.waitForURL()\`,
   \`waitForResponse()\`. Nunca \`sleep\` o \`setTimeout\` fijos.

4. **Tests independientes**: cada \`test()\` / \`it()\` parte de estado limpio.
   Usar \`beforeEach\` para navegar a la URL base si todos lo necesitan.

5. **Data de prueba realista**: emails con dominios reales (\`test@example.com\`),
   nombres plausibles, etc. Si necesitás credenciales para login, usar variables
   de entorno (\`process.env.TEST_USER_EMAIL\`) con un comentario indicando dónde
   setearlas.

6. **Manejo de errores**: usar \`expect()\` con mensajes descriptivos cuando ayude.

7. **Listo para correr**: imports correctos, sin TODOs, sin código comentado.

8. **Comentarios concisos en español** describiendo el "porqué" de cada test
   (1 línea max por sección).

═══════════════════════════════════════════════════════════════════════
FORMATO POR FRAMEWORK
═══════════════════════════════════════════════════════════════════════

▶ **Playwright (TypeScript)** — archivo \`.spec.ts\`
  - \`import { test, expect } from '@playwright/test';\`
  - Usar \`test.describe('Suite name', () => {...})\` para agrupar.
  - Preferir \`page.getByRole()\`, \`page.getByLabel()\`, \`page.getByTestId()\`.

▶ **Cypress (JavaScript)** — archivo \`.cy.js\`
  - \`describe('Suite name', () => { beforeEach(() => cy.visit(URL)); it(...) })\`
  - \`cy.get()\`, \`cy.contains()\`, \`cy.intercept()\` para mocks si hace falta.

▶ **Selenium (Python)** — clase Python con \`unittest.TestCase\`
  - \`from selenium import webdriver; from selenium.webdriver.common.by import By\`
  - \`from selenium.webdriver.support.ui import WebDriverWait\`
  - \`from selenium.webdriver.support import expected_conditions as EC\`
  - \`setUp()\` que lanza \`webdriver.Chrome()\` y va a la URL; \`tearDown()\` que cierra.
  - Cada test es un método \`test_\`. Usar \`WebDriverWait\` con \`EC.visibility_of_element_located\`,
    nunca \`time.sleep()\`.

═══════════════════════════════════════════════════════════════════════
META-REGLAS
═══════════════════════════════════════════════════════════════════════

- **No inventar features**: solo testear lo que el DOM sugiere o lo que un sitio
  de este tipo razonablemente tiene. Si no hay form de login, no inventes uno.
- **Casos adicionales del usuario**: si los provee, agregarlos como tests extras
  dentro del MISMO archivo (no archivos separados) manteniendo el estilo.
- **Idioma**: comentarios en español, identificadores en inglés.

Devuelve ÚNICAMENTE el JSON estructurado que el schema define — sin texto adicional
ni explicaciones fuera del JSON.`;

export const SCRIPT_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    playwright: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['typescript'] },
        content: { type: 'string' },
      },
      required: ['language', 'content'],
      additionalProperties: false,
    },
    cypress: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['javascript'] },
        content: { type: 'string' },
      },
      required: ['language', 'content'],
      additionalProperties: false,
    },
    selenium: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python'] },
        content: { type: 'string' },
      },
      required: ['language', 'content'],
      additionalProperties: false,
    },
  },
  required: ['playwright', 'cypress', 'selenium'],
  additionalProperties: false,
});

function summarizeCapture(captureData) {
  if (!captureData) return null;
  const links = Array.isArray(captureData.links) ? captureData.links : [];
  const internalSample = links.filter((l) => !l.href?.startsWith('http')).slice(0, 15);
  const externalSample = links.filter((l) => l.href?.startsWith('http')).slice(0, 10);
  return {
    url: captureData.url,
    finalUrl: captureData.finalUrl,
    httpStatus: captureData.httpStatus,
    title: captureData.title,
    htmlLang: captureData.htmlLang,
    meta: pickKeys(captureData.meta || {}, [
      'description',
      'og:title',
      'og:description',
      'og:url',
      'viewport',
      'robots',
    ]),
    headings: {
      h1: (captureData.headings?.h1 || []).slice(0, 5),
      h2: (captureData.headings?.h2 || []).slice(0, 8),
    },
    forms: (captureData.forms || []).map((f) => ({
      id: f.id,
      action: f.action,
      method: f.method,
      inputs: (f.inputs || []).map((i) => ({
        tag: i.tag,
        type: i.type,
        name: i.name,
        id: i.id,
        placeholder: i.placeholder,
        required: i.required,
      })),
    })),
    linksInternal: internalSample.map((l) => ({ href: l.href, text: l.text })),
    linksExternal: externalSample.map((l) => ({ href: l.href, text: l.text })),
  };
}

function pickKeys(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = obj[k];
  return out;
}

function buildUserMessage({ scan, captureSummary, additionalCases }) {
  const lines = [
    `URL bajo análisis: ${scan.url}`,
    '',
    'Datos capturados (resumen del DOM):',
    '```json',
    JSON.stringify(captureSummary ?? { note: 'No se capturó el DOM correctamente' }, null, 2),
    '```',
  ];
  if (additionalCases && additionalCases.trim()) {
    lines.push(
      '',
      'Casos adicionales solicitados por el usuario (agregar como tests extras dentro del mismo archivo):',
      additionalCases.trim(),
    );
  }
  lines.push('', 'Genera ahora los 3 scripts según el schema JSON definido.');
  return lines.join('\n');
}

/**
 * @param {{ scanId: string, additionalCases?: string|null, force?: boolean, provider?: string, model?: string }} args
 */
export async function generateScriptsForScan({
  scanId,
  additionalCases = null,
  force = false,
  provider: requestedProviderId = null,
  model: requestedModel = null,
} = {}) {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: {
      scripts: true,
      results: { where: { testName: 'playwright.capture' } },
    },
  });
  if (!scan) {
    const err = new Error('Scan no encontrado');
    err.status = 404;
    err.code = 'SCAN_NOT_FOUND';
    throw err;
  }

  if (!force && !additionalCases && scan.scripts.length === FRAMEWORKS_META.length) {
    return { cached: true, scripts: scan.scripts };
  }

  const captureResult = scan.results[0];
  if (!captureResult) {
    const err = new Error(
      'El scan no tiene resultado de playwright.capture — esperá que termine el scan antes de generar scripts.',
    );
    err.status = 409;
    err.code = 'CAPTURE_NOT_READY';
    throw err;
  }

  const provider = await resolveProvider({ requestedId: requestedProviderId });
  const captureData = parseDetails(captureResult.details);
  const captureSummary = summarizeCapture(captureData);

  const result = await provider.generateStructured({
    system: SYSTEM_PROMPT,
    user: buildUserMessage({ scan, captureSummary, additionalCases }),
    schema: SCRIPT_OUTPUT_SCHEMA,
    model: requestedModel,
  });

  const parsed = result.parsed;
  if (!parsed || typeof parsed !== 'object') {
    const err = new Error('El provider no devolvió un JSON parseable');
    err.status = 502;
    err.code = 'INVALID_LLM_RESPONSE';
    throw err;
  }

  const scripts = await prisma.$transaction(async (tx) => {
    await tx.script.deleteMany({ where: { scanId } });
    const created = [];
    for (const { key, language } of FRAMEWORKS_META) {
      const entry = parsed[key];
      if (!entry?.content) continue;
      const script = await tx.script.create({
        data: { scanId, framework: key, language, content: entry.content },
      });
      created.push(script);
    }
    return created;
  });

  return {
    cached: false,
    scripts,
    usage: result.usage,
    provider: result.providerId,
    model: result.model,
  };
}
