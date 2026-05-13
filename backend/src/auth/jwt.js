// Firma y verificación de JWTs de sesión. Stateless — no hay tabla Session.

import jwt from 'jsonwebtoken';

const DEFAULT_EXPIRES = '30d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'JWT_SECRET no configurada (o demasiado corta). Setear un string >=16 chars en las envs.',
    );
  }
  return secret;
}

export function signToken(payload, { expiresIn = DEFAULT_EXPIRES } = {}) {
  return jwt.sign(payload, getSecret(), { expiresIn });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}
