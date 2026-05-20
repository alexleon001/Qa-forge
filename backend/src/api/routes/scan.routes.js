// Rutas para crear y consultar scans. POST /api/scan inicia un scan en queue.

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { parseDetails, prisma } from '../../db/client.js';
import { enqueueScan } from '../../queue/scan.queue.js';
import { encrypt } from '../../auth/crypto.js';
import {
  BROWSER_ENGINES,
  DEFAULT_BROWSER_ENGINE,
  DEFAULT_DEVICE_PROFILE,
  DEVICE_PROFILES,
  MAX_CRAWL_PAGES,
  SCAN_MODE,
  SCAN_STATUS,
} from '../../../../shared/constants.js';

export const scanRouter = Router();

const urlSchema = z
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
  }, 'url debe ser una URL http(s) válida');

const loginConfigSchema = z
  .object({
    url: urlSchema,
    usernameSelector: z.string().trim().min(1, 'usernameSelector requerido').max(500),
    passwordSelector: z.string().trim().min(1, 'passwordSelector requerido').max(500),
    username: z.string().min(1, 'username requerido').max(500),
    password: z.string().min(1, 'password requerido').max(500),
    submitSelector: z.string().trim().min(1, 'submitSelector requerido').max(500),
    postLoginUrl: z.string().trim().optional(),
    waitForSelector: z.string().trim().max(500).optional(),
  })
  .strict();

const createScanSchema = z.object({
  url: urlSchema,
  deviceProfile: z
    .enum(Object.keys(DEVICE_PROFILES))
    .optional()
    .nullable(),
  browserEngine: z
    .enum(Object.keys(BROWSER_ENGINES))
    .optional()
    .nullable(),
  mode: z.enum(Object.values(SCAN_MODE)).optional(),
  maxPages: z.number().int().min(1).max(MAX_CRAWL_PAGES).optional(),
  loginConfig: loginConfigSchema.optional().nullable(),
});

scanRouter.post('/', async (req, res, next) => {
  try {
    const parse = createScanSchema.safeParse(req.body);
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const { url, deviceProfile, browserEngine, mode, maxPages, loginConfig } = parse.data;

    // Si vino loginConfig, cifrar la password antes de persistirla en JSON
    let storedLoginConfig = null;
    if (loginConfig) {
      try {
        storedLoginConfig = {
          url: loginConfig.url,
          usernameSelector: loginConfig.usernameSelector,
          passwordSelector: loginConfig.passwordSelector,
          username: loginConfig.username,
          encryptedPassword: encrypt(loginConfig.password),
          submitSelector: loginConfig.submitSelector,
          postLoginUrl: loginConfig.postLoginUrl || undefined,
          waitForSelector: loginConfig.waitForSelector || undefined,
        };
      } catch (err) {
        throw new HttpError(
          500,
          'ENCRYPTION_FAILED',
          `No se pudo cifrar la password de login: ${err.message}`,
        );
      }
    }

    const scan = await prisma.scan.create({
      data: {
        url,
        status: SCAN_STATUS.PENDING,
        userId: req.user?.id ?? null,
        deviceProfile: deviceProfile ?? DEFAULT_DEVICE_PROFILE,
        browserEngine: browserEngine ?? DEFAULT_BROWSER_ENGINE,
        mode: mode ?? SCAN_MODE.SINGLE,
        maxPages: maxPages ?? 1,
        loginConfig: storedLoginConfig ?? undefined,
      },
    });

    await enqueueScan(scan.id);

    res.status(201).json({
      scanId: scan.id,
      url: scan.url,
      status: scan.status,
      mode: scan.mode,
      maxPages: scan.maxPages,
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
      include: {
        results: true,
        children: {
          select: { id: true, url: true, status: true, completedAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!scan) throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');

    res.json({
      ...scan,
      loginConfig: sanitizeLoginConfigForResponse(scan.loginConfig),
      results: scan.results.map((r) => ({ ...r, details: parseDetails(r.details) })),
    });
  } catch (err) {
    next(err);
  }
});

/** Quita la password cifrada antes de mandar el scan al frontend. */
function sanitizeLoginConfigForResponse(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const { encryptedPassword, ...rest } = cfg;
  return { ...rest, hasPassword: Boolean(encryptedPassword) };
}

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

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const listScansQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

scanRouter.get('/', async (req, res, next) => {
  try {
    const parse = listScansQuerySchema.safeParse(req.query ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Query inválida');
    }
    const page = parse.data.page ?? 1;
    const pageSize = parse.data.pageSize ?? DEFAULT_PAGE_SIZE;

    // Si el user está autenticado, solo sus scans. Si no, los que no tienen
    // owner (modo legacy / pre-auth) — para no romper backcompat de scans viejos.
    // Excluimos child scans (parentScanId != null): se ven dentro del parent.
    const where = req.user
      ? { userId: req.user.id, parentScanId: null }
      : { userId: null, parentScanId: null };

    // count + page en una sola transacción para que el total sea consistente.
    const [total, scans] = await prisma.$transaction([
      prisma.scan.count({ where }),
      prisma.scan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          url: true,
          status: true,
          stage: true,
          mode: true,
          maxPages: true,
          parentScanId: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    res.json({
      scans,
      pagination: { page, pageSize, total, totalPages, hasMore: page < totalPages },
    });
  } catch (err) {
    next(err);
  }
});
