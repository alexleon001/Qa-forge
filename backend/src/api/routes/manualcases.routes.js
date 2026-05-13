// Endpoints para generar y consultar casos de prueba manuales (FASE 6).

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import {
  generateManualCasesForScan,
  getManualCasesForScan,
} from '../../generators/manualcases.generator.js';

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
