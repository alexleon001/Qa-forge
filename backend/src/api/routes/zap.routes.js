// Rutas de OWASP ZAP (#14). Dos sub-recursos bajo /api/zap:
//  - /config: el daemon ZAP del usuario (apiUrl + apiKey cifrada). 1 por usuario.
//  - /scans: scans de seguridad (spider/baseline/full) encolados a zap.queue.
// Todo scoped al usuario autenticado.

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { ZapError, getVersion, normalizeApiUrl } from '../../integrations/zap.client.js';
import { decrypt, encrypt, maskKey } from '../../auth/crypto.js';
import { enqueueZapScan } from '../../queue/zap.queue.js';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { SCAN_STATUS, ZAP_SCAN_MODES } from '../../../../shared/constants.js';

export const zapRouter = Router();
zapRouter.use(requireAuth);

// ─── Config ──────────────────────────────────────────────────────────────────

const configSchema = z.object({
  apiUrl: z.string().trim().min(1, 'apiUrl requerida').max(500),
  apiKey: z.string().trim().max(500).optional().nullable(),
});

function sanitizeConfig(cfg) {
  if (!cfg) return null;
  const { encryptedApiKey, ...rest } = cfg;
  return { ...rest, hasApiKey: Boolean(encryptedApiKey) };
}

zapRouter.get('/config', async (req, res, next) => {
  try {
    const cfg = await prisma.zapConfig.findUnique({ where: { userId: req.user.id } });
    res.json({ configured: Boolean(cfg), config: sanitizeConfig(cfg) });
  } catch (err) {
    next(err);
  }
});

zapRouter.put('/config', async (req, res, next) => {
  try {
    const parse = configSchema.safeParse(req.body ?? {});
    if (!parse.success) throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    const d = parse.data;
    try {
      normalizeApiUrl(d.apiUrl);
    } catch (err) {
      throw new HttpError(400, 'INVALID_URL', err.message);
    }
    const data = { apiUrl: d.apiUrl.trim() };
    if (d.apiKey) {
      data.encryptedApiKey = encrypt(d.apiKey);
      data.hint = maskKey(d.apiKey);
    } else if (d.apiKey === '') {
      // string vacío explícito = quitar la key
      data.encryptedApiKey = null;
      data.hint = null;
    }
    const cfg = await prisma.zapConfig.upsert({
      where: { userId: req.user.id },
      update: data,
      create: { userId: req.user.id, ...data },
    });
    res.json({ config: sanitizeConfig(cfg) });
  } catch (err) {
    next(err);
  }
});

zapRouter.delete('/config', async (req, res, next) => {
  try {
    await prisma.zapConfig.deleteMany({ where: { userId: req.user.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/** Test de conectividad: GET version del daemon. Acepta config en el body o usa la guardada. */
zapRouter.post('/config/test', async (req, res, next) => {
  try {
    let apiUrl = req.body?.apiUrl?.trim();
    let apiKey = req.body?.apiKey?.trim() || null;
    if (!apiUrl) {
      const cfg = await prisma.zapConfig.findUnique({ where: { userId: req.user.id } });
      if (!cfg) throw new HttpError(404, 'NO_CONFIG', 'No hay config de ZAP guardada');
      apiUrl = cfg.apiUrl;
      if (cfg.encryptedApiKey) {
        try {
          apiKey = decrypt(cfg.encryptedApiKey);
        } catch {
          throw new HttpError(500, 'DECRYPT_FAILED', 'No se pudo descifrar la apiKey');
        }
      }
    }
    try {
      const version = await getVersion({ apiUrl, apiKey });
      res.json({ ok: true, version });
    } catch (err) {
      if (err instanceof ZapError) throw new HttpError(err.status, err.code, err.message);
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// ─── Scans ───────────────────────────────────────────────────────────────────

const urlSchema = z
  .string()
  .trim()
  .min(1, 'url requerida')
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'url debe ser http(s) válida');

const scanSchema = z.object({
  url: urlSchema,
  mode: z.enum(Object.keys(ZAP_SCAN_MODES)).optional(),
});

zapRouter.post('/scans', async (req, res, next) => {
  try {
    const parse = scanSchema.safeParse(req.body ?? {});
    if (!parse.success) throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    const cfg = await prisma.zapConfig.findUnique({ where: { userId: req.user.id } });
    if (!cfg) throw new HttpError(409, 'NO_CONFIG', 'Configurá el daemon ZAP antes de scanear');
    const scan = await prisma.zapScan.create({
      data: {
        userId: req.user.id,
        url: parse.data.url,
        mode: parse.data.mode ?? 'baseline',
        status: SCAN_STATUS.PENDING,
      },
    });
    await enqueueZapScan(scan.id);
    res.status(201).json({ scan });
  } catch (err) {
    next(err);
  }
});

zapRouter.get('/scans', async (req, res, next) => {
  try {
    const scans = await prisma.zapScan.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, url: true, mode: true, status: true, phase: true, summary: true, createdAt: true, completedAt: true },
    });
    res.json({ scans });
  } catch (err) {
    next(err);
  }
});

zapRouter.get('/scans/:id', async (req, res, next) => {
  try {
    const scan = await prisma.zapScan.findUnique({ where: { id: req.params.id } });
    if (!scan || scan.userId !== req.user.id) throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');
    res.json({ scan });
  } catch (err) {
    next(err);
  }
});

zapRouter.post('/scans/:id/cancel', async (req, res, next) => {
  try {
    const scan = await prisma.zapScan.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true, status: true } });
    if (!scan || scan.userId !== req.user.id) throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');
    if ([SCAN_STATUS.COMPLETED, SCAN_STATUS.FAILED, SCAN_STATUS.CANCELLED].includes(scan.status)) {
      throw new HttpError(409, 'SCAN_FINISHED', 'El scan ya terminó');
    }
    const updated = await prisma.zapScan.update({
      where: { id: req.params.id },
      data: { cancelRequestedAt: new Date() },
      select: { id: true, status: true, cancelRequestedAt: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

zapRouter.delete('/scans/:id', async (req, res, next) => {
  try {
    const scan = await prisma.zapScan.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true } });
    if (!scan || scan.userId !== req.user.id) throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');
    await prisma.zapScan.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
