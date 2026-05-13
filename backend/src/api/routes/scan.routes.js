// Rutas para crear y consultar scans. POST /api/scan inicia un scan en queue.

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { parseDetails, prisma } from '../../db/client.js';
import { enqueueScan } from '../../queue/scan.queue.js';
import { SCAN_STATUS } from '../../../../shared/constants.js';

export const scanRouter = Router();

const createScanSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'url requerido')
    .refine((value) => {
      try {
        const u = new URL(value);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'url debe ser una URL http(s) válida'),
});

scanRouter.post('/', async (req, res, next) => {
  try {
    const parse = createScanSchema.safeParse(req.body);
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const { url } = parse.data;

    const scan = await prisma.scan.create({
      data: { url, status: SCAN_STATUS.PENDING },
    });

    await enqueueScan(scan.id);

    res.status(201).json({
      scanId: scan.id,
      url: scan.url,
      status: scan.status,
      createdAt: scan.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

scanRouter.get('/:id', async (req, res, next) => {
  try {
    const scan = await prisma.scan.findUnique({
      where: { id: req.params.id },
      include: { results: true },
    });
    if (!scan) throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');

    res.json({
      ...scan,
      results: scan.results.map((r) => ({ ...r, details: parseDetails(r.details) })),
    });
  } catch (err) {
    next(err);
  }
});

const patchScanSchema = z.object({
  notes: z.string().max(20_000).optional().nullable(),
});

scanRouter.patch('/:id', async (req, res, next) => {
  try {
    const parse = patchScanSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const data = {};
    if (parse.data.notes !== undefined) data.notes = parse.data.notes;
    if (Object.keys(data).length === 0) {
      throw new HttpError(400, 'INVALID_INPUT', 'No hay campos para actualizar');
    }
    const scan = await prisma.scan.update({
      where: { id: req.params.id },
      data,
      select: { id: true, notes: true },
    });
    res.json(scan);
  } catch (err) {
    if (err?.code === 'P2025') {
      return next(new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado'));
    }
    next(err);
  }
});

scanRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const scan = await prisma.scan.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!scan) throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');
    if (scan.status === SCAN_STATUS.COMPLETED || scan.status === SCAN_STATUS.FAILED) {
      throw new HttpError(409, 'SCAN_FINISHED', 'El scan ya terminó');
    }
    const updated = await prisma.scan.update({
      where: { id: req.params.id },
      data: { cancelRequestedAt: new Date() },
      select: { id: true, status: true, cancelRequestedAt: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

scanRouter.get('/', async (_req, res, next) => {
  try {
    const scans = await prisma.scan.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        url: true,
        status: true,
        stage: true,
        createdAt: true,
        completedAt: true,
      },
    });
    res.json({ scans });
  } catch (err) {
    next(err);
  }
});
