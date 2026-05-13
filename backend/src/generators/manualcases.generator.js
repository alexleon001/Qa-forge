// Generador de casos de prueba manuales (FASE 6).
// Reusa la abstracción multi-provider de FASE 5: solo arma prompt + summary del
// DOM y delega al provider elegido. Persiste como Script con framework="manual".

import { parseDetails, prisma } from '../db/client.js';
import { resolveProvider } from './providers/index.js';

/** Constante interna — coincide con SCRIPT_FRAMEWORK pero agregamos "manual". */
export const MANUAL_FRAMEWORK = 'manual';
export const MANUAL_LANGUAGE = 'json';

const SYSTEM_PROMPT = `Eres un QA Lead senior experto en diseño de casos de prueba manuales.

Tu tarea: generar una **batería de casos de prueba manuales** para que un tester
humano pueda ejecutarlos paso a paso sobre la URL analizada. Basate en el resumen
del DOM, forms detectados, links, headings, y meta tags que recibes.

Reglas:

1. **Cobertura por categoría**: cubrir funcional, seguridad, performance, accesibilidad
   y SEO. Mínimo 1 caso por categoría aplicable (si no hay datos, omitir esa categoría).
2. **Pasos accionables**: cada paso debe ser una instrucción concreta que un humano
   pueda seguir sin ambigüedad. Evitar pasos del tipo "verificar que todo funcione".
3. **Resultado esperado por paso**: cada paso lleva su \`expected\` (qué tiene que pasar).
4. **Preconditions**: lo que debe estar listo antes (browser abierto, usuario logueado, etc.).
5. **Priorización**: usar \`priority\` ∈ \`critical | high | medium | low\` según impacto.
6. **IDs estables**: cada test case tiene un \`id\` único con formato \`TC-{CATEGORIA}-{NRO}\`
   (ej: \`TC-FUNC-01\`, \`TC-SEC-03\`).
7. **Idioma español**, conciso y profesional.
8. **Casos negativos**: incluir al menos 1-2 casos negativos (inputs inválidos, edge cases).
9. **Sin scripts**: estos son casos MANUALES — no incluir código, sólo pasos en lenguaje natural.

Si el usuario provee "casos adicionales", agregarlos al output como test cases extras
respetando el mismo schema.

Devuelve ÚNICAMENTE el JSON estructurado que el schema define — sin texto adicional
ni explicaciones fuera del JSON.`;

export const MANUAL_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    testCases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          category: {
            type: 'string',
            enum: ['functional', 'security', 'performance', 'accessibility', 'seo'],
          },
          priority: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low'],
          },
          preconditions: { type: 'array', items: { type: 'string' } },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                expected: { type: 'string' },
              },
              required: ['action', 'expected'],
              additionalProperties: false,
            },
          },
          postconditions: { type: 'array', items: { type: 'string' } },
          testData: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['id', 'title', 'category', 'priority', 'steps'],
        additionalProperties: false,
      },
    },
  },
  required: ['testCases'],
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
      'Casos adicionales solicitados por el usuario (agregar como test cases extras dentro del array):',
      additionalCases.trim(),
    );
  }
  lines.push(
    '',
    'Genera ahora la batería de casos de prueba manuales según el schema JSON definido.',
  );
  return lines.join('\n');
}

/**
 * @param {{ scanId: string, additionalCases?: string|null, force?: boolean, provider?: string, model?: string }} args
 */
export async function generateManualCasesForScan({
  scanId,
  additionalCases = null,
  force = false,
  provider: requestedProviderId = null,
  model: requestedModel = null,
} = {}) {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: {
      scripts: { where: { framework: MANUAL_FRAMEWORK } },
      results: { where: { testName: 'playwright.capture' } },
    },
  });
  if (!scan) {
    const err = new Error('Scan no encontrado');
    err.status = 404;
    err.code = 'SCAN_NOT_FOUND';
    throw err;
  }

  if (!force && !additionalCases && scan.scripts.length > 0) {
    return { cached: true, manualCases: parseStoredCases(scan.scripts[0]), record: scan.scripts[0] };
  }

  const captureResult = scan.results[0];
  if (!captureResult) {
    const err = new Error(
      'El scan no tiene resultado de playwright.capture — esperá que termine el scan antes de generar casos manuales.',
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
    schema: MANUAL_OUTPUT_SCHEMA,
    model: requestedModel,
  });

  const parsed = result.parsed;
  if (!parsed || !Array.isArray(parsed.testCases)) {
    const err = new Error('El provider no devolvió un JSON parseable con testCases');
    err.status = 502;
    err.code = 'INVALID_LLM_RESPONSE';
    throw err;
  }

  const record = await prisma.$transaction(async (tx) => {
    await tx.script.deleteMany({ where: { scanId, framework: MANUAL_FRAMEWORK } });
    return tx.script.create({
      data: {
        scanId,
        framework: MANUAL_FRAMEWORK,
        language: MANUAL_LANGUAGE,
        content: JSON.stringify(parsed.testCases),
      },
    });
  });

  return {
    cached: false,
    manualCases: parsed.testCases,
    record,
    usage: result.usage,
    provider: result.providerId,
    model: result.model,
  };
}

/** Lee los casos manuales persistidos para un scan (404 si no hay). */
export async function getManualCasesForScan(scanId) {
  const record = await prisma.script.findFirst({
    where: { scanId, framework: MANUAL_FRAMEWORK },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) return null;
  return { record, manualCases: parseStoredCases(record) };
}

function parseStoredCases(record) {
  try {
    const parsed = JSON.parse(record.content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
