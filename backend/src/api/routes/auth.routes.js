// Endpoints de autenticación: register, login, me.

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { hashPassword, verifyPassword } from '../../auth/crypto.js';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { signToken } from '../../auth/jwt.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido'),
  password: z
    .string()
    .min(8, 'Password debe tener al menos 8 caracteres')
    .max(200, 'Password demasiado larga'),
  name: z.string().trim().max(80).optional().nullable(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido'),
  password: z.string().min(1, 'Password requerida'),
});

const ALLOW_REGISTRATION =
  String(process.env.ALLOW_REGISTRATION ?? 'true').toLowerCase() === 'true';

authRouter.post('/register', async (req, res, next) => {
  try {
    if (!ALLOW_REGISTRATION) {
      throw new HttpError(
        403,
        'REGISTRATION_CLOSED',
        'El registro de nuevos usuarios está cerrado. Pedile acceso a un admin.',
      );
    }
    const parse = registerSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const { email, password, name } = parse.data;

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'Ya existe un usuario con ese email');
    }

    const passwordHash = await hashPassword(password);
    // El primer user del sistema queda como admin automáticamente.
    const userCount = await prisma.user.count();
    const role = userCount === 0 ? 'admin' : 'user';

    const user = await prisma.user.create({
      data: { email, passwordHash, name: name ?? null, role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    res.status(201).json({ user, token });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const parse = loginSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const { email, password } = parse.data;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, name: true, role: true },
    });
    if (!user) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o password incorrectos');
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o password incorrectos');
    }

    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});
