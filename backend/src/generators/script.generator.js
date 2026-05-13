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

const SYSTEM_PROMPT = `Eres un ingeniero senior de QA Automation experto en Playwright, Cypress y Selenium.

Tu tarea: generar **tres scripts de tests E2E**, uno por cada framework solicitado, basados
en la URL y el DOM analizado que recibes. Los scripts deben:

1. **Cubrir flujos detectados**: navegación a la URL, validación de title/meta, interacción
   con forms si existen (rellenar inputs visibles con datos válidos genéricos), verificación
   de links internos clave.
2. **Selectores robustos**: preferir \`data-testid\`, luego texto visible, luego CSS estables.
   Evitar selectores frágiles (XPath absoluto, nth-child profundo).
3. **Async/await**: nunca callbacks. Manejar timeouts y waits explícitos (\`waitFor\`,
   \`expect.toBeVisible\`, etc.), nunca \`sleep\` fijo.
4. **Independientes**: cada test crea su propio estado. No depender del orden de ejecución.
5. **Listos para usar**: compilan/ejecutan sin modificaciones (asumiendo el framework instalado).
   Incluir imports correctos en la primera línea.
6. **Comentarios concisos en español** explicando los pasos clave (1 línea por sección).

Formato exacto de cada script:

- **Playwright (TypeScript)**: archivo \`.spec.ts\` con \`import { test, expect } from '@playwright/test'\`.
- **Cypress (JavaScript)**: archivo \`.cy.js\` con \`describe()\` + \`it()\`.
- **Selenium (Python)**: clase con \`unittest.TestCase\` + \`webdriver.Chrome()\` + selectores
  \`By.CSS_SELECTOR\`. Incluir \`setUp\` y \`tearDown\`.

Si el usuario provee "casos adicionales", agregarlos como tests extra dentro del mismo archivo
(no como archivos separados).

Devuelve ÚNICAMENTE el JSON estructurado que el schema define — sin texto adicional ni
explicaciones fuera del JSON.`;

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
