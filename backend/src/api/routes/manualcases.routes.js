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
import { prisma } from '../../db/client.js';
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

/** Definición de un caso custom creado a mano por el usuario. */
const customPayloadSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio').max(300),
  category: z.enum(RUN_CATEGORY),
  priority: z.enum([...MANUAL_CASE_PRIORITY]),
  description: z.string().trim().max(4_000).optional().nullable(),
});

/** Body del upsert de un item del runner. */
const runUpsertSchema = z.object({
  caseKey: z.string().trim().min(1).max(200).optional().nullable(),
  source: z.enum(['generic', 'ai', 'custom']),
  status: z.enum(RUN_STATUS).optional(),
  notes: z.string().trim().max(4_000).optional().nullable(),
  payload: customPayloadSchema.optional().nullable(),
});

/** Verifica que el scan exista; lanza 404 si no. */
async function assertScanExists(scanId) {
  const scan = await prisma.scan.findUnique({ where: { id: scanId }, select: { id: true } });
  if (!scan) {
    throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');
  }
}

/**
 * GET /api/manual-cases/:scanId/run
 * Estado del runner: catálogo genérico fijo + items trackeados de este scan.
 */
manualCasesRouter.get('/:scanId/run', async (req, res, next) => {
  try {
    const { scanId } = req.params;
    await assertScanExists(scanId);
    const items = await prisma.manualCaseRun.findMany({
      where: { scanId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ scanId, catalog: GENERIC_TEST_CASES, items });
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

    if (source === 'custom') {
      if (!caseKey) {
        if (!payload) {
          throw new HttpError(400, 'INVALID_INPUT', 'Un caso custom nuevo requiere payload con la definición.');
        }
        caseKey = `custom:${randomUUID()}`;
      }
    } else {
      if (!caseKey) {
        throw new HttpError(400, 'INVALID_INPUT', 'caseKey es obligatorio para casos generic/ai.');
      }
      payload = null; // generic/ai no guardan definición — vive en su origen
    }

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
