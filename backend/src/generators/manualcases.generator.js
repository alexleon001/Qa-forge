// Generador de casos de prueba manuales (FASE 6).
// Reusa la abstracción multi-provider de FASE 5: solo arma prompt + summary del
// DOM y delega al provider elegido. Persiste como Script con framework="manual".

import { parseDetails, prisma } from '../db/client.js';
import { resolveProvider } from './providers/index.js';

/** Constante interna — coincide con SCRIPT_FRAMEWORK pero agregamos "manual". */
export const MANUAL_FRAMEWORK = 'manual';
export const MANUAL_LANGUAGE = 'json';

const SYSTEM_PROMPT = `Eres un QA Lead senior con 10+ años diseñando suites de pruebas manuales
para sitios web complejos. Tu rol es producir una batería **exhaustiva, profesional
y ejecutable** que un tester humano pueda correr paso a paso.

Basate en el resumen del DOM, forms detectados, links, headings y meta tags
recibidos. Cuando algo no esté en los datos, **inferí** flujos plausibles a partir
de la naturaleza del sitio (ecommerce, blog, SaaS, landing, etc.) y diseñá pruebas
para esos flujos también.

═══════════════════════════════════════════════════════════════════════
COBERTURA OBLIGATORIA — generar al menos los siguientes casos por categoría
═══════════════════════════════════════════════════════════════════════

▶ FUNCIONAL (mínimo 6-10 casos)
  - Navegación a cada sección principal del menú/header detectado
  - Para CADA form detectado: 1 happy path + 1-2 casos negativos
    (campos vacíos, formatos inválidos, límites de caracteres)
  - Si hay form de login/signup: cubrir credenciales válidas, inválidas, vacías,
    formato de email inválido, contraseña débil, "recordar sesión", recuperación
    de contraseña
  - Si hay buscador: búsqueda válida, búsqueda sin resultados, búsqueda con
    caracteres especiales, búsqueda vacía
  - Si parece ecommerce: agregar al carrito, modificar cantidad, eliminar,
    proceder a checkout, abandono de carrito
  - Si hay formulario de contacto: envío válido, validación de email/teléfono,
    archivos adjuntos (si soporta)
  - Persistencia de sesión, logout, timeout

▶ SEGURIDAD (mínimo 4-6 casos)
  - Validación de inputs contra XSS (\`<script>alert(1)</script>\` en cada campo)
  - Validación contra SQL injection (\`' OR '1'='1\`) en campos de búsqueda y login
  - Headers de seguridad presentes (HSTS, CSP, X-Frame-Options)
  - Enlaces externos: deberían usar \`rel="noopener noreferrer"\`
  - HTTPS forzado: cualquier request HTTP debe redirigir a HTTPS
  - Si hay login: rate-limiting de intentos fallidos, fortaleza de contraseña
  - Cookies: flags Secure y HttpOnly en cookies sensibles

▶ ACCESIBILIDAD (mínimo 3-5 casos)
  - Navegación completa con teclado (Tab, Shift+Tab, Enter, Esc)
  - Lectores de pantalla: alt en imágenes, aria-label en botones sin texto
  - Contraste de color en textos sobre fondos
  - Zoom 200% sin pérdida de funcionalidad
  - Foco visible en elementos interactivos

▶ PERFORMANCE (mínimo 2-3 casos)
  - Tiempo de carga inicial (objetivo: < 3s en 4G simulado)
  - Lazy loading de imágenes / scroll infinito si aplica
  - Comportamiento bajo conexión lenta (DevTools throttling 3G)

▶ SEO (mínimo 2-3 casos)
  - Title, meta description, Open Graph tags presentes y descriptivos
  - URLs amigables, breadcrumbs, sitemap.xml/robots.txt
  - H1 único por página, jerarquía de headings correcta

═══════════════════════════════════════════════════════════════════════
CALIDAD DE CADA CASO
═══════════════════════════════════════════════════════════════════════

1. **Pasos accionables**: cada paso es una instrucción atómica e inambigua.
   ✘ Mal: "verificar que el form funcione"
   ✓ Bien: "Hacer click en el botón 'Iniciar sesión' del header superior"
2. **Expected por cada paso**: qué tiene que pasar exactamente.
   ✓ "El sistema redirige a /dashboard y muestra el nombre del usuario en el header"
3. **Preconditions explícitas**: lo que debe estar listo antes (browser abierto en
   la URL, usuario logueado con rol X, cookies limpias, etc.).
4. **Test data realista**: cuando aplique, inventar datos concretos
   (\`email: test+qa@example.com\`, \`teléfono: +54 11 1234-5678\`).
5. **Priorización honesta**: \`critical\` solo para flujos donde el negocio se
   rompe (login, checkout, formulario principal). \`high\` para features visibles.
   \`medium\` para variaciones. \`low\` para cosmético.
6. **IDs únicos**: formato \`TC-{CATEGORIA}-{NRO}\` (TC-FUNC-01, TC-SEC-03, etc.).
   Numerar continuo dentro de cada categoría.
7. **Notas con contexto**: si hay supuestos o limitaciones, anotarlos en \`notes\`.

═══════════════════════════════════════════════════════════════════════
META-REGLAS
═══════════════════════════════════════════════════════════════════════

- **Idioma**: español neutro, conciso, profesional.
- **Cantidad objetivo**: 15-25 casos en total. NO menos de 15 salvo que el sitio
  sea trivial (landing estática de 1 pantalla sin forms).
- **No inventar features fantasía**: solo cubrí lo que el DOM sugiere o lo que
  un sitio de este tipo razonablemente tendría.
- **Casos adicionales del usuario**: si los provee, agregarlos como casos extras
  CON el mismo nivel de detalle, manteniendo IDs secuenciales.
- **Sin código**: estos son casos MANUALES. No scripts, no selectores CSS, solo
  pasos en lenguaje natural que un humano sigue.

Devuelve ÚNICAMENTE el JSON estructurado que el schema define — sin texto
adicional, sin markdown, sin explicaciones fuera del JSON.`;

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
  userId = null,
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

  const { provider, apiKey } = await resolveProvider({
    requestedId: requestedProviderId,
    userId,
  });
  const captureData = parseDetails(captureResult.details);
  const captureSummary = summarizeCapture(captureData);

  const result = await provider.generateStructured({
    system: SYSTEM_PROMPT,
    user: buildUserMessage({ scan, captureSummary, additionalCases }),
    schema: MANUAL_OUTPUT_SCHEMA,
    model: requestedModel,
    apiKey,
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
