// CRUD de API keys de IA por usuario. Las keys se guardan cifradas en DB.

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { encrypt, maskKey } from '../../auth/crypto.js';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

export const userKeysRouter = Router();

const PROVIDERS = ['anthropic', 'gemini', 'openai', 'openrouter', 'ollama'];

const createKeySchema = z.object({
  provider: z.enum(PROVIDERS),
  key: z.string().trim().min(8, 'API key demasiado corta').max(500),
  label: z.string().trim().max(80).optional().nullable(),
  isDefault: z.boolean().optional(),
});

userKeysRouter.use(requireAuth);

/** GET /api/user/api-keys → lista de keys del user (sin el valor descifrado). */
userKeysRouter.get('/', async (req, res, next) => {
  try {
    const keys = await prisma.userApiKey.findMany({
      where: { userId: req.user.id },
      orderBy: [{ provider: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        provider: true,
        label: true,
        hint: true,
        isDefault: true,
        createdAt: true,
      },
    });
    res.json({ apiKeys: keys });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/user/api-keys
 * Body: { provider, key, label?, isDefault? }
 */
userKeysRouter.post('/', async (req, res, next) => {
  try {
    const parse = createKeySchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const { provider, key, label, isDefault } = parse.data;

    const encryptedKey = encrypt(key);
    const hint = maskKey(key);

    const created = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        // Solo una key default por (user, provider).
        await tx.userApiKey.updateMany({
          where: { userId: req.user.id, provider },
          data: { isDefault: false },
        });
      }
      return tx.userApiKey.create({
        data: {
          userId: req.user.id,
          provider,
          label: label ?? null,
          encryptedKey,
          hint,
          isDefault: Boolean(isDefault),
        },
        select: {
          id: true,
          provider: true,
          label: true,
          hint: true,
          isDefault: true,
          createdAt: true,
        },
      });
    });

    res.status(201).json({ apiKey: created });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/user/api-keys/:id */
userKeysRouter.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.userApiKey.findUnique({
      where: { id: req.params.id },
      select: { userId: true },
    });
    if (!existing || existing.userId !== req.user.id) {
      throw new HttpError(404, 'KEY_NOT_FOUND', 'API key no encontrada');
    }
    await prisma.userApiKey.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/user/api-keys/:id/default — marca esta key como default del provider. */
userKeysRouter.patch('/:id/default', async (req, res, next) => {
  try {
    const existing = await prisma.userApiKey.findUnique({
      where: { id: req.params.id },
      select: { userId: true, provider: true },
    });
    if (!existing || existing.userId !== req.user.id) {
      throw new HttpError(404, 'KEY_NOT_FOUND', 'API key no encontrada');
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.userApiKey.updateMany({
        where: { userId: req.user.id, provider: existing.provider },
        data: { isDefault: false },
      });
      return tx.userApiKey.update({
        where: { id: req.params.id },
        data: { isDefault: true },
        select: {
          id: true,
          provider: true,
          label: true,
          hint: true,
          isDefault: true,
          createdAt: true,
        },
      });
    });
    res.json({ apiKey: updated });
  } catch (err) {
    next(err);
  }
});
