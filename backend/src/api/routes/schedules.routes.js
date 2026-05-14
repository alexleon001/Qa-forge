// CRUD de scheduled scans (FASE 8.6). Solo accesible para usuarios autenticados;
// cada user ve y modifica únicamente sus schedules.

import { Router } from 'express';
import { z } from 'zod';

import { encrypt } from '../../auth/crypto.js';
import { prisma } from '../../db/client.js';
import { enqueueScan } from '../../queue/scan.queue.js';
import { computeNextRunAt, validateCron } from '../../schedules/cron.master.js';
import {
  BROWSER_ENGINES,
  DEFAULT_BROWSER_ENGINE,
  DEFAULT_DEVICE_PROFILE,
  DEVICE_PROFILES,
  MAX_CRAWL_PAGES,
  SCAN_MODE,
  SCAN_STATUS,
} from '../../../../shared/constants.js';
import { HttpError } from '../middlewares/error.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

export const schedulesRouter = Router();

const urlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'url inválida');

const loginConfigSchema = z
  .object({
    url: urlSchema,
    usernameSelector: z.string().min(1).max(500),
    passwordSelector: z.string().min(1).max(500),
    username: z.string().min(1).max(500),
    password: z.string().min(1).max(500),
    submitSelector: z.string().min(1).max(500),
    postLoginUrl: z.string().optional(),
    waitForSelector: z.string().max(500).optional(),
  })
  .strict()
  .optional()
  .nullable();

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  cron: z.string().trim().min(1).max(120),
  timezone: z.string().trim().max(80).optional(),
  enabled: z.boolean().optional(),
  url: urlSchema,
  deviceProfile: z.enum(Object.keys(DEVICE_PROFILES)).optional(),
  browserEngine: z.enum(Object.keys(BROWSER_ENGINES)).optional(),
  mode: z.enum(Object.values(SCAN_MODE)).optional(),
  maxPages: z.number().int().min(1).max(MAX_CRAWL_PAGES).optional(),
  loginConfig: loginConfigSchema,
  notifyWebhook: z.string().url().optional().nullable(),
  notifyEmail: z.string().email().optional().nullable(),
  notifyOn: z.enum(['always', 'onFailOnly', 'onWarningOrFail']).optional(),
});

const updateSchema = createSchema.partial();

schedulesRouter.use(requireAuth);

schedulesRouter.get('/', async (req, res, next) => {
  try {
    const schedules = await prisma.scheduledScan.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ schedules: schedules.map(sanitize) });
  } catch (err) {
    next(err);
  }
});

schedulesRouter.post('/', async (req, res, next) => {
  try {
    const parse = createSchema.safeParse(req.body);
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const data = parse.data;
    const cronCheck = validateCron(data.cron, data.timezone || 'UTC');
    if (!cronCheck.valid) {
      throw new HttpError(400, 'INVALID_CRON', `Expresión cron inválida: ${cronCheck.error}`);
    }
    const storedLogin = data.loginConfig ? buildStoredLoginConfig(data.loginConfig) : null;

    const created = await prisma.scheduledScan.create({
      data: {
        userId: req.user.id,
        name: data.name,
        cron: data.cron,
        timezone: data.timezone || 'UTC',
        enabled: data.enabled ?? true,
        url: data.url,
        deviceProfile: data.deviceProfile ?? DEFAULT_DEVICE_PROFILE,
        browserEngine: data.browserEngine ?? DEFAULT_BROWSER_ENGINE,
        mode: data.mode ?? SCAN_MODE.SINGLE,
        maxPages: data.maxPages ?? 1,
        loginConfig: storedLogin ?? undefined,
        notifyWebhook: data.notifyWebhook || null,
        notifyEmail: data.notifyEmail || null,
        notifyOn: data.notifyOn ?? 'always',
        nextRunAt: cronCheck.nextRunAt,
      },
    });
    res.status(201).json(sanitize(created));
  } catch (err) {
    next(err);
  }
});

schedulesRouter.patch('/:id', async (req, res, next) => {
  try {
    const parse = updateSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const existing = await prisma.scheduledScan.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Schedule no encontrado');

    const data = parse.data;
    const patch = { ...data };

    if (data.cron) {
      const check = validateCron(data.cron, data.timezone ?? existing.timezone);
      if (!check.valid) {
        throw new HttpError(400, 'INVALID_CRON', `Expresión cron inválida: ${check.error}`);
      }
      patch.nextRunAt = check.nextRunAt;
    } else if (data.timezone && existing.cron) {
      const check = validateCron(existing.cron, data.timezone);
      if (check.valid) patch.nextRunAt = check.nextRunAt;
    }

    if (data.loginConfig === null) {
      patch.loginConfig = null;
    } else if (data.loginConfig) {
      patch.loginConfig = buildStoredLoginConfig(data.loginConfig);
    }

    const updated = await prisma.scheduledScan.update({
      where: { id: existing.id },
      data: patch,
    });
    res.json(sanitize(updated));
  } catch (err) {
    next(err);
  }
});

schedulesRouter.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.scheduledScan.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Schedule no encontrado');
    await prisma.scheduledScan.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

schedulesRouter.post('/:id/run', async (req, res, next) => {
  try {
    const schedule = await prisma.scheduledScan.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!schedule) throw new HttpError(404, 'NOT_FOUND', 'Schedule no encontrado');
    const scan = await prisma.scan.create({
      data: {
        url: schedule.url,
        status: SCAN_STATUS.PENDING,
        userId: schedule.userId,
        deviceProfile: schedule.deviceProfile,
        browserEngine: schedule.browserEngine,
        mode: schedule.mode,
        maxPages: schedule.maxPages,
        loginConfig: schedule.loginConfig ?? undefined,
        scheduledScanId: schedule.id,
      },
      select: { id: true, url: true, status: true },
    });
    await enqueueScan(scan.id);
    await prisma.scheduledScan.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date(), lastScanId: scan.id },
    });
    res.status(202).json(scan);
  } catch (err) {
    next(err);
  }
});

/**
 * Endpoint utilitario: valida una expresión cron y devuelve el próximo run.
 * Útil para preview en el form.
 */
schedulesRouter.post('/validate-cron', async (req, res, next) => {
  try {
    const parse = z
      .object({ cron: z.string(), timezone: z.string().optional() })
      .safeParse(req.body ?? {});
    if (!parse.success) throw new HttpError(400, 'INVALID_INPUT', 'Body inválido');
    const r = validateCron(parse.data.cron, parse.data.timezone || 'UTC');
    res.json(r);
    void computeNextRunAt; // referencia para evitar warning de unused export
  } catch (err) {
    next(err);
  }
});

function buildStoredLoginConfig(raw) {
  return {
    url: raw.url,
    usernameSelector: raw.usernameSelector,
    passwordSelector: raw.passwordSelector,
    username: raw.username,
    encryptedPassword: encrypt(raw.password),
    submitSelector: raw.submitSelector,
    postLoginUrl: raw.postLoginUrl || undefined,
    waitForSelector: raw.waitForSelector || undefined,
  };
}

/** Quita campos sensibles (encryptedPassword) antes de devolver. */
function sanitize(schedule) {
  const { loginConfig, ...rest } = schedule;
  if (loginConfig) {
    const { encryptedPassword, ...safe } = loginConfig;
    return { ...rest, loginConfig: { ...safe, hasPassword: Boolean(encryptedPassword) } };
  }
  return { ...rest, loginConfig: null };
}
