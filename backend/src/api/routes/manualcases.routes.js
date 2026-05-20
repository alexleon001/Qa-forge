// Endpoints para generar y consultar casos de prueba manuales (FASE 6) y para
// el runner de ejecución manual (FASE 9): checklist genérico + casos IA + casos
// custom con estado pass/fail por scan.

import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import {
  generateManualCasesForScan,
  getManualCasesForScan,
} from '../../generators/manualcases.generator.js';
import { parseDetails, prisma } from '../../db/client.js';
import {
  GENERIC_TEST_CASES,
  MANUAL_CASE_PRIORITY,
} from '../../../../shared/constants.js';

export const manualCasesRouter = Router();

const generateBodySchema = z.object({
  additionalCases: z.string().trim().max(4_000).optional().nullable(),
  force: z.boolean().optional(),
  provider: z
    .enum(['anthropic', 'gemini', 'openai', 'openrouter', 'ollama', 'auto'])
    .optional()
    .nullable(),
  model: z.string().trim().max(200).optional().nullable(),
});

/**
 * POST /api/manual-cases/:scanId
 * Body: { additionalCases?, force?, provider?, model? }
 */
manualCasesRouter.post('/:scanId', async (req, res, next) => {
  try {
    const parse = generateBodySchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(
        400,
        'INVALID_INPUT',
        parse.error.errors[0]?.message ?? 'Body inválido',
      );
    }

    const result = await generateManualCasesForScan({
      scanId: req.params.scanId,
      additionalCases: parse.data.additionalCases ?? null,
      force: parse.data.force ?? false,
      provider: parse.data.provider ?? null,
      model: parse.data.model ?? null,
      userId: req.user?.id ?? null,
    });

    res.status(result.cached ? 200 : 201).json({
      scanId: req.params.scanId,
      cached: result.cached,
      provider: result.provider ?? null,
      model: result.model ?? null,
      generatedAt: result.record?.createdAt ?? null,
      testCases: result.manualCases,
      usage: result.usage ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/manual-cases/:scanId
 * Devuelve los casos manuales ya generados (404 si no hay).
 */
manualCasesRouter.get('/:scanId', async (req, res, next) => {
  try {
    const data = await getManualCasesForScan(req.params.scanId);
    if (!data) {
      throw new HttpError(404, 'NO_MANUAL_CASES', 'No hay casos manuales generados para este scan');
    }
    res.json({
      scanId: req.params.scanId,
      generatedAt: data.record.createdAt,
      testCases: data.manualCases,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Runner de ejecución manual (FASE 9) ────────────────────────────────────

const RUN_STATUS = ['pending', 'pass', 'fail', 'blocked', 'skipped'];
const RUN_CATEGORY = ['functional', 'security', 'performance', 'accessibility', 'seo'];

const runStepSchema = z.object({
  action: z.string().trim().max(2_000),
  expected: z.string().trim().max(2_000),
});

/**
 * Definición/override de un caso del runner. Para casos `custom` es la
 * definición completa; para `generic`/`ai`/`repo` es un override editable que
 * el frontend mergea sobre el caso base (permite corregir errores por scan).
 * `hidden: true` oculta el caso del runner sin borrar el caso base.
 */
const runPayloadSchema = z.object({
  title: z.string().trim().max(300).optional(),
  category: z.enum(RUN_CATEGORY).optional(),
  priority: z.enum([...MANUAL_CASE_PRIORITY]).optional(),
  description: z.string().trim().max(4_000).nullable().optional(),
  preconditions: z.array(z.string().max(1_000)).max(50).optional(),
  steps: z.array(runStepSchema).max(100).optional(),
  postconditions: z.array(z.string().max(1_000)).max(50).optional(),
  testData: z.string().max(4_000).nullable().optional(),
  code: z.string().max(40).optional(),
  hidden: z.boolean().optional(),
});

/** Body del upsert de un item del runner. */
const runUpsertSchema = z.object({
  caseKey: z.string().trim().min(1).max(200).optional().nullable(),
  source: z.enum(['generic', 'ai', 'custom', 'repo']),
  status: z.enum(RUN_STATUS).optional(),
  notes: z.string().trim().max(4_000).optional().nullable(),
  payload: runPayloadSchema.optional().nullable(),
});

/** Verifica que el scan exista; lanza 404 si no. */
async function assertScanExists(scanId) {
  const scan = await prisma.scan.findUnique({ where: { id: scanId }, select: { id: true } });
  if (!scan) {
    throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');
  }
}

/**
 * Reglas de pre-llenado: mapean un caso genérico a un Result automático del
 * scan. Permiten sugerir pass/fail sin que el QA re-verifique a mano lo que la
 * herramienta ya chequeó. `axeRule` mira una violación puntual de axe.
 */
const SUGGESTION_RULES = [
  { key: 'gen-func-01', testName: 'playwright.capture', label: 'la captura del DOM' },
  { key: 'gen-func-04', testName: 'links.analyzer', label: 'el chequeo de links' },
  { key: 'gen-sec-01', testName: 'security.ssl', label: 'el chequeo SSL/HTTPS' },
  { key: 'gen-sec-02', testName: 'security.ssl', label: 'el chequeo del certificado' },
  { key: 'gen-sec-03', testName: 'security.headers', label: 'el chequeo de headers' },
  { key: 'gen-perf-01', testName: 'performance.pagespeed', label: 'PageSpeed Insights' },
  { key: 'gen-seo-01', testName: 'seo.analyzer', label: 'el análisis SEO' },
  { key: 'gen-seo-02', testName: 'seo.analyzer', label: 'el análisis SEO' },
  { key: 'gen-a11y-02', testName: 'accessibility.axe', label: 'axe', axeRule: 'image-alt' },
  { key: 'gen-a11y-03', testName: 'accessibility.axe', label: 'axe', axeRule: 'color-contrast' },
];

/** Deriva sugerencias de pass/fail para casos genéricos desde los Results. */
function buildSuggestions(results) {
  const byName = {};
  for (const r of results) byName[r.testName] = r;
  const out = {};
  for (const rule of SUGGESTION_RULES) {
    const r = byName[rule.testName];
    if (!r) continue;
    const details = parseDetails(r.details) || {};
    if (details.error) continue; // el test automático falló — no sugerir

    let status;
    let extra = '';
    if (rule.axeRule) {
      const violations = Array.isArray(details.violations) ? details.violations : [];
      const hit = violations.find((v) => v && v.id === rule.axeRule);
      status = hit ? 'fail' : 'pass';
      if (hit) extra = ` (regla "${rule.axeRule}")`;
    } else if (r.status === 'pass') {
      status = 'pass';
    } else if (r.status === 'fail' || r.status === 'warning') {
      status = 'fail';
    } else {
      continue; // info → sin sugerencia
    }

    const verdict = status === 'pass' ? 'sin problemas' : 'con problemas';
    out[rule.key] = {
      status,
      reason: `El scan automático (${rule.label}) lo reportó ${verdict}${extra}.`,
    };
  }
  return out;
}

/**
 * GET /api/manual-cases/:scanId/run
 * Estado del runner: catálogo genérico fijo, items trackeados de este scan y
 * sugerencias de pass/fail derivadas de los Results automáticos.
 */
manualCasesRouter.get('/:scanId/run', async (req, res, next) => {
  try {
    const { scanId } = req.params;
    await assertScanExists(scanId);
    const [items, results] = await Promise.all([
      prisma.manualCaseRun.findMany({ where: { scanId }, orderBy: { createdAt: 'asc' } }),
      prisma.result.findMany({
        where: { scanId },
        select: { testName: true, status: true, score: true, details: true },
      }),
    ]);
    res.json({
      scanId,
      catalog: GENERIC_TEST_CASES,
      items,
      suggestions: buildSuggestions(results),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/manual-cases/:scanId/run
 * Upsert de un item del runner. Body: { caseKey?, source, status?, notes?, payload? }.
 * - source=custom sin caseKey → crea un caso nuevo (payload obligatorio).
 * - source=generic|ai → trackea estado/notas de un caso del catálogo o de la IA.
 */
manualCasesRouter.put('/:scanId/run', async (req, res, next) => {
  try {
    const { scanId } = req.params;
    const parse = runUpsertSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    await assertScanExists(scanId);

    const { source, status, notes } = parse.data;
    let { caseKey, payload } = parse.data;

    if (source === 'custom' && !caseKey) {
      // Caso custom nuevo — necesita al menos un título.
      if (!payload?.title || !payload.title.trim()) {
        throw new HttpError(400, 'INVALID_INPUT', 'Un caso custom nuevo requiere un título.');
      }
      caseKey = `custom:${randomUUID()}`;
    } else if (!caseKey) {
      throw new HttpError(400, 'INVALID_INPUT', 'caseKey es obligatorio.');
    }
    // generic/ai/repo conservan `payload` como override editable del caso base.

    // executedAt marca cuándo se pasó a un estado terminal (no-pending).
    const executedAt = status && status !== 'pending' ? new Date() : null;

    const item = await prisma.manualCaseRun.upsert({
      where: { scanId_caseKey: { scanId, caseKey } },
      create: {
        scanId,
        source,
        caseKey,
        status: status ?? 'pending',
        notes: notes ?? null,
        payload: payload ?? undefined,
        executedAt,
      },
      update: {
        ...(status !== undefined ? { status, executedAt } : {}),
        ...(notes !== undefined ? { notes: notes ?? null } : {}),
        ...(payload != null ? { payload } : {}),
      },
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/manual-cases/:scanId/run/:caseKey
 * Borra un item del runner. Para casos custom elimina el caso entero; para
 * generic/ai simplemente deja de trackear su estado (vuelve a "sin ejecutar").
 */
manualCasesRouter.delete('/:scanId/run/:caseKey', async (req, res, next) => {
  try {
    const { scanId, caseKey } = req.params;
    const deleted = await prisma.manualCaseRun.deleteMany({ where: { scanId, caseKey } });
    if (deleted.count === 0) {
      throw new HttpError(404, 'NOT_FOUND', 'Ese caso no estaba trackeado en el runner.');
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const runBulkSchema = z.object({
  items: z
    .array(
      z.object({
        caseKey: z.string().trim().min(1).max(200),
        source: z.enum(['generic', 'ai', 'custom']),
        status: z.enum(RUN_STATUS),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * PUT /api/manual-cases/:scanId/run/bulk
 * Upsert masivo de estados (acciones tipo "aplicar sugerencias", "marcar
 * categoría"). Body: { items: [{ caseKey, source, status }] }.
 */
manualCasesRouter.put('/:scanId/run/bulk', async (req, res, next) => {
  try {
    const { scanId } = req.params;
    const parse = runBulkSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    await assertScanExists(scanId);
    const now = new Date();
    await prisma.$transaction(
      parse.data.items.map((it) => {
        const executedAt = it.status !== 'pending' ? now : null;
        return prisma.manualCaseRun.upsert({
          where: { scanId_caseKey: { scanId, caseKey: it.caseKey } },
          create: { scanId, source: it.source, caseKey: it.caseKey, status: it.status, executedAt },
          update: { status: it.status, executedAt },
        });
      }),
    );
    const items = await prisma.manualCaseRun.findMany({
      where: { scanId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/manual-cases/:scanId/run
 * Resetea el runner: borra todos los items trackeados (vuelven a "pendiente").
 */
manualCasesRouter.delete('/:scanId/run', async (req, res, next) => {
  try {
    await prisma.manualCaseRun.deleteMany({ where: { scanId: req.params.scanId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Conteos por estado de una corrida. */
function summarizeRun(items) {
  const counts = { pending: 0, pass: 0, fail: 0, blocked: 0, skipped: 0 };
  for (const it of items) counts[it.status] = (counts[it.status] ?? 0) + 1;
  return { ...counts, total: items.length, executed: items.length - counts.pending };
}

const snapshotSchema = z.object({
  label: z.string().trim().min(1, 'Poné un nombre a la corrida').max(120),
  reset: z.boolean().optional(),
  items: z
    .array(
      z.object({
        caseKey: z.string().max(200),
        source: z.string().max(20),
        title: z.string().max(400),
        category: z.string().max(40),
        priority: z.string().max(20).optional(),
        status: z.enum(RUN_STATUS),
        notes: z.string().max(4_000).nullable().optional(),
      }),
    )
    .max(1_000),
});

/**
 * POST /api/manual-cases/:scanId/run/snapshots
 * Cierra una corrida: archiva el estado de todos los casos como snapshot. Con
 * `reset: true` además limpia el runner para empezar otra ronda de regresión.
 */
manualCasesRouter.post('/:scanId/run/snapshots', async (req, res, next) => {
  try {
    const { scanId } = req.params;
    const parse = snapshotSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    await assertScanExists(scanId);
    const { label, reset, items } = parse.data;

    const snapshot = await prisma.$transaction(async (tx) => {
      const snap = await tx.manualRunSnapshot.create({
        data: { scanId, label, summary: summarizeRun(items), items },
      });
      if (reset) await tx.manualCaseRun.deleteMany({ where: { scanId } });
      return snap;
    });
    res.status(201).json({ snapshot });
  } catch (err) {
    next(err);
  }
});

/** GET /api/manual-cases/:scanId/run/snapshots — corridas archivadas del scan. */
manualCasesRouter.get('/:scanId/run/snapshots', async (req, res, next) => {
  try {
    const snapshots = await prisma.manualRunSnapshot.findMany({
      where: { scanId: req.params.scanId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ snapshots });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/manual-cases/:scanId/run/snapshots/:id — borra una corrida archivada. */
manualCasesRouter.delete('/:scanId/run/snapshots/:id', async (req, res, next) => {
  try {
    const deleted = await prisma.manualRunSnapshot.deleteMany({
      where: { id: req.params.id, scanId: req.params.scanId },
    });
    if (deleted.count === 0) {
      throw new HttpError(404, 'NOT_FOUND', 'Corrida archivada no encontrada.');
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const importRepoSchema = z.object({
  caseIds: z.array(z.string().trim().min(1)).min(1).max(500),
});

/**
 * POST /api/manual-cases/:scanId/run/import-repo
 * Trae casos del repositorio (FASE 10) al runner como casos `repo`. Body:
 * { caseIds }. Cada caso queda como un ManualCaseRun con la definición completa
 * (pasos, precondiciones) en `payload`.
 */
manualCasesRouter.post('/:scanId/run/import-repo', async (req, res, next) => {
  try {
    const { scanId } = req.params;
    const parse = importRepoSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    await assertScanExists(scanId);

    const cases = await prisma.testCase.findMany({ where: { id: { in: parse.data.caseIds } } });
    if (cases.length === 0) {
      throw new HttpError(404, 'NO_CASES', 'No se encontró ningún caso del repositorio.');
    }

    await prisma.$transaction(
      cases.map((tc) => {
        const caseKey = `repo:${tc.id}`;
        const payload = {
          code: tc.code,
          title: tc.title,
          category: tc.category,
          priority: tc.priority,
          description: tc.description,
          preconditions: tc.preconditions,
          steps: tc.steps,
          postconditions: tc.postconditions,
          testData: tc.testData,
        };
        return prisma.manualCaseRun.upsert({
          where: { scanId_caseKey: { scanId, caseKey } },
          create: { scanId, source: 'repo', caseKey, status: 'pending', payload },
          update: { payload },
        });
      }),
    );

    const items = await prisma.manualCaseRun.findMany({
      where: { scanId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ imported: cases.length, items });
  } catch (err) {
    next(err);
  }
});
