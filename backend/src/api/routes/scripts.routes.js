// Endpoints para generar y consultar scripts de automatización (FASE 3 + FASE 5).

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { prisma } from '../../db/client.js';
import { generateScriptsForScan } from '../../generators/script.generator.js';
import { PROVIDERS, listProvidersStatus } from '../../generators/providers/index.js';

export const scriptsRouter = Router();

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
 * GET /api/scripts/providers
 * Lista los providers disponibles y cuáles están configurados.
 */
scriptsRouter.get('/providers', async (_req, res, next) => {
  try {
    const items = await listProvidersStatus();
    res.json({
      providers: items,
      defaultProvider:
        items.find((p) => p.isDefault)?.id ?? Object.keys(PROVIDERS)[0],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/scripts/:scanId
 * Body: { additionalCases?, force?, provider?, model? }
 */
scriptsRouter.post('/:scanId', async (req, res, next) => {
  try {
    const parse = generateBodySchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(
        400,
        'INVALID_INPUT',
        parse.error.errors[0]?.message ?? 'Body inválido',
      );
    }

    const result = await generateScriptsForScan({
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
      scripts: result.scripts.map(toApiShape),
      usage: result.usage ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/scripts/:scanId
 * Lista los scripts ya generados.
 */
scriptsRouter.get('/:scanId', async (req, res, next) => {
  try {
    const scripts = await prisma.script.findMany({
      where: { scanId: req.params.scanId },
      orderBy: { framework: 'asc' },
    });
    if (scripts.length === 0) {
      throw new HttpError(404, 'NO_SCRIPTS', 'No hay scripts generados para este scan');
    }
    res.json({ scanId: req.params.scanId, scripts: scripts.map(toApiShape) });
  } catch (err) {
    next(err);
  }
});

function toApiShape(script) {
  return {
    id: script.id,
    framework: script.framework,
    language: script.language,
    content: script.content,
    createdAt: script.createdAt,
  };
}
