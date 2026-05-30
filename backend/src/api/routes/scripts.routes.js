// Endpoints para generar y consultar scripts de automatización (FASE 3 + FASE 5).

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { prisma } from '../../db/client.js';
import { generateScriptsForScan } from '../../generators/script.generator.js';
import { healScriptSelectors } from '../../generators/selector.healer.js';
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
 * Lista los providers disponibles y cuáles están configurados (env o user).
 */
scriptsRouter.get('/providers', async (req, res, next) => {
  try {
    const items = await listProvidersStatus({ userId: req.user?.id });
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
      userId: req.user?.id ?? null,
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

const healBodySchema = z.object({
  // provider se valida en resolveProvider (acepta cualquiera del registry o "auto").
  provider: z.string().trim().max(40).optional().nullable(),
  model: z.string().trim().max(200).optional().nullable(),
  apply: z.boolean().optional(),
  // Contenido ya revisado en el preview: si viene con apply=true, se persiste tal
  // cual (sin re-correr browser+LLM → evita gasto y no-determinismo del LLM).
  healedContent: z.string().max(200_000).optional().nullable(),
});

/**
 * POST /api/scripts/:scanId/heal
 * Auto-healing de selectores del script Playwright: verifica cada selector contra
 * la URL en vivo y la IA repara los rotos. Body: { provider?, model?, apply?, healedContent? }.
 * - apply=true + healedContent → persiste el contenido revisado (no recomputa).
 * - sin apply → devuelve solo el preview (report + healedContent).
 */
scriptsRouter.post('/:scanId/heal', async (req, res, next) => {
  try {
    const parse = healBodySchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }

    // Atajo de "aplicar": persistir el contenido ya revisado, sin re-correr el heal.
    if (parse.data.apply && parse.data.healedContent) {
      const script = await prisma.script.findFirst({
        where: { scanId: req.params.scanId, framework: 'playwright' },
      });
      if (!script) {
        throw new HttpError(404, 'NO_PLAYWRIGHT_SCRIPT', 'No hay script Playwright para este scan');
      }
      await prisma.script.update({
        where: { id: script.id },
        data: { content: parse.data.healedContent },
      });
      res.json({ scanId: req.params.scanId, applied: true, healedContent: parse.data.healedContent });
      return;
    }

    const result = await healScriptSelectors({
      scanId: req.params.scanId,
      provider: parse.data.provider ?? null,
      model: parse.data.model ?? null,
      apply: parse.data.apply ?? false,
      userId: req.user?.id ?? null,
    });

    res.json({
      scanId: req.params.scanId,
      report: result.report,
      healedContent: result.healedContent,
      applied: result.applied,
      healedCount: result.healedCount,
      brokenCount: result.brokenCount,
      checkedCount: result.checkedCount,
      provider: result.provider ?? null,
      model: result.model ?? null,
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
