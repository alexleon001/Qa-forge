// Singleton de PrismaClient para todo el backend.

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__qaForgePrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__qaForgePrisma__ = prisma;
}

/**
 * Helper para serializar a string el campo `details` de Result.
 * Prisma+SQLite no soporta @db.JsonB nativo en todos los providers, por eso lo
 * guardamos como String y serializamos/deserializamos aquí.
 */
export const serializeDetails = (value) => JSON.stringify(value ?? null);

export const parseDetails = (raw) => {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};
