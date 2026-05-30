// Rutas de AI exploratory testing. Sesiones independientes, scoped al usuario.
// POST crea + encola la sesión; el worker (explore.queue) corre el agente.

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { encrypt } from '../../auth/crypto.js';
import { enqueueExploration } from '../../queue/explore.queue.js';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import {
  BROWSER_ENGINES,
  DEFAULT_BROWSER_ENGINE,
  DEFAULT_DEVICE_PROFILE,
  DEFAULT_EXPLORE_MAX_STEPS,
  DEVICE_PROFILES,
  MAX_EXPLORE_STEPS,
  SCAN_STATUS,
} from '../../../../shared/constants.js';

export const exploreRouter = Router();
exploreRouter.use(requireAuth);

const urlSchema = z
  .string()
  .trim()
  .min(1, 'url requerido')
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'url debe ser http(s) válida');

const loginConfigSchema = z
  .object({
    url: urlSchema,
    usernameSelector: z.string().trim().min(1).max(500),
    passwordSelector: z.string().trim().min(1).max(500),
    username: z.string().min(1).max(500),
    password: z.string().min(1).max(500),
    submitSelector: z.string().trim().min(1).max(500),
    postLoginUrl: z.string().trim().optional(),
    waitForSelector: z.string().trim().max(500).optional(),
  })
  .strict();

const createSchema = z.object({
  url: urlSchema,
  deviceProfile: z.enum(Object.keys(DEVICE_PROFILES)).optional().nullable(),
  browserEngine: z.enum(Object.keys(BROWSER_ENGINES)).optional().nullable(),
  maxSteps: z.number().int().min(1).max(MAX_EXPLORE_STEPS).optional(),
  goal: z.string().trim().max(2_000).optional().nullable(),
  provider: z.string().trim().max(40).optional().nullable(),
  model: z.string().trim().max(200).optional().nullable(),
  loginConfig: loginConfigSchema.optional().nullable(),
});

/** Quita la password cifrada antes de devolver la sesión al frontend. */
function sanitizeSession(session) {
  if (!session) return session;
  let loginConfig = null;
  if (session.loginConfig && typeof session.loginConfig === 'object') {
    const { encryptedPassword, ...rest } = session.loginConfig;
    loginConfig = { ...rest, hasPassword: Boolean(encryptedPassword) };
  }
  return { ...session, loginConfig };
}

exploreRouter.post('/', async (req, res, next) => {
  try {
    const parse = createSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const d = parse.data;

    let storedLoginConfig;
    if (d.loginConfig) {
      try {
        storedLoginConfig = {
          url: d.loginConfig.url,
          usernameSelector: d.loginConfig.usernameSelector,
          passwordSelector: d.loginConfig.passwordSelector,
          username: d.loginConfig.username,
          encryptedPassword: encrypt(d.loginConfig.password),
          submitSelector: d.loginConfig.submitSelector,
          postLoginUrl: d.loginConfig.postLoginUrl || undefined,
          waitForSelector: d.loginConfig.waitForSelector || undefined,
        };
      } catch (err) {
        throw new HttpError(500, 'ENCRYPTION_FAILED', `No se pudo cifrar la password de login: ${err.message}`);
      }
    }

    const session = await prisma.exploratorySession.create({
      data: {
        userId: req.user.id,
        url: d.url,
        deviceProfile: d.deviceProfile ?? DEFAULT_DEVICE_PROFILE,
        browserEngine: d.browserEngine ?? DEFAULT_BROWSER_ENGINE,
        maxSteps: d.maxSteps ?? DEFAULT_EXPLORE_MAX_STEPS,
        goal: d.goal ?? null,
        provider: d.provider ?? null,
        model: d.model ?? null,
        loginConfig: storedLoginConfig ?? undefined,
        status: SCAN_STATUS.PENDING,
      },
    });

    await enqueueExploration(session.id);
    res.status(201).json({ session: sanitizeSession(session) });
  } catch (err) {
    next(err);
  }
});

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

exploreRouter.get('/', async (req, res, next) => {
  try {
    const parse = listQuerySchema.safeParse(req.query ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Query inválida');
    }
    const page = parse.data.page ?? 1;
    const pageSize = parse.data.pageSize ?? DEFAULT_PAGE_SIZE;
    const where = { userId: req.user.id };

    const [total, sessions] = await prisma.$transaction([
      prisma.exploratorySession.count({ where }),
      prisma.exploratorySession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          url: true,
          status: true,
          goal: true,
          maxSteps: true,
          currentStep: true,
          summary: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ]);
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    res.json({ sessions, pagination: { page, pageSize, total, totalPages, hasMore: page < totalPages } });
  } catch (err) {
    next(err);
  }
});

exploreRouter.get('/:id', async (req, res, next) => {
  try {
    const session = await prisma.exploratorySession.findUnique({ where: { id: req.params.id } });
    if (!session || session.userId !== req.user.id) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada');
    }
    res.json({ session: sanitizeSession(session) });
  } catch (err) {
    next(err);
  }
});

exploreRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const session = await prisma.exploratorySession.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, status: true },
    });
    if (!session || session.userId !== req.user.id) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada');
    }
    if (session.status === SCAN_STATUS.COMPLETED || session.status === SCAN_STATUS.FAILED) {
      throw new HttpError(409, 'SESSION_FINISHED', 'La sesión ya terminó');
    }
    const updated = await prisma.exploratorySession.update({
      where: { id: req.params.id },
      data: { cancelRequestedAt: new Date() },
      select: { id: true, status: true, cancelRequestedAt: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

exploreRouter.delete('/:id', async (req, res, next) => {
  try {
    const session = await prisma.exploratorySession.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true },
    });
    if (!session || session.userId !== req.user.id) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada');
    }
    await prisma.exploratorySession.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
