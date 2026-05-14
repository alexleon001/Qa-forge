// Endpoints para servir screenshots (baseline | current | diff) de visual
// regression. Devuelve PNG binario para que el browser lo embed con <img src>.

import { Router } from 'express';

import { HttpError } from '../middlewares/error.middleware.js';
import { prisma } from '../../db/client.js';

export const visualRouter = Router();

const VALID_KINDS = new Set(['baseline', 'current', 'diff']);

/**
 * Sirve la imagen PNG del screenshot del scanId solicitado.
 *   GET /api/scan/:id/screenshot/:kind  → image/png
 *   GET /api/scan/:id/screenshot?kind=diff → image/png (alt query form)
 */
visualRouter.get('/:id/screenshot/:kind', async (req, res, next) => {
  try {
    const { id, kind } = req.params;
    await sendScreenshot(res, id, kind);
  } catch (err) {
    next(err);
  }
});

visualRouter.get('/:id/screenshot', async (req, res, next) => {
  try {
    const kind = String(req.query.kind || 'current');
    await sendScreenshot(res, req.params.id, kind);
  } catch (err) {
    next(err);
  }
});

async function sendScreenshot(res, scanId, kind) {
  if (!VALID_KINDS.has(kind)) {
    throw new HttpError(400, 'INVALID_KIND', `kind debe ser uno de ${[...VALID_KINDS].join('|')}`);
  }
  // Tomamos el más reciente que coincida con la tupla.
  const shot = await prisma.screenshot.findFirst({
    where: { scanId, kind },
    orderBy: { createdAt: 'desc' },
    select: { dataB64: true, width: true, height: true, createdAt: true },
  });
  if (!shot) {
    throw new HttpError(404, 'SCREENSHOT_NOT_FOUND', `No hay screenshot ${kind} para este scan`);
  }
  const buf = Buffer.from(shot.dataB64, 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(buf);
}
