// Middlewares de autenticación. Atan el JWT entrante al req.user.

import { prisma } from '../../db/client.js';
import { verifyToken } from '../../auth/jwt.js';
import { HttpError } from './error.middleware.js';

/**
 * Si hay JWT válido en Authorization: Bearer, hidrata req.user con
 * { id, email, role }. Si no hay token o es inválido, deja req.user undefined
 * (NO bloquea). Útil para endpoints que aceptan auth opcional.
 */
export async function attachUser(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  const token = header.slice('Bearer '.length).trim();
  const payload = verifyToken(token);
  if (!payload?.sub) return next();
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, name: true },
    });
    if (user) req.user = user;
  } catch {
    // Si la DB falla, seguimos sin user — el endpoint decide qué hacer.
  }
  next();
}

/** Bloquea si no hay user logueado. Devuelve 401. */
export function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(new HttpError(401, 'UNAUTHENTICATED', 'Sesión requerida'));
  }
  next();
}

/** Bloquea si el user no tiene el rol pedido. */
export function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new HttpError(401, 'UNAUTHENTICATED', 'Sesión requerida'));
    }
    if (req.user.role !== role) {
      return next(new HttpError(403, 'FORBIDDEN', `Rol "${role}" requerido`));
    }
    next();
  };
}
