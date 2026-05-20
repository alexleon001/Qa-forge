// Registry de providers + selección por env / request.
// FASE 7: además de las keys del env, busca keys del user logueado en la
// tabla UserApiKey y las usa cuando están disponibles.

import { anthropicProvider } from './anthropic.provider.js';
import { decrypt } from '../../auth/crypto.js';
import { geminiProvider } from './gemini.provider.js';
import { ollamaProvider } from './ollama.provider.js';
import { openaiProvider } from './openai.provider.js';
import { opencodeProvider } from './opencode.provider.js';
import { openrouterProvider } from './openrouter.provider.js';
import { prisma } from '../../db/client.js';
import { ProviderError } from './base.js';

/** Orden de listado (también orden de auto-fallback si AI_PROVIDER=auto). */
export const PROVIDERS = Object.freeze({
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
  opencode: opencodeProvider,
  ollama: ollamaProvider,
});

export const DEFAULT_PROVIDER_ID = process.env.AI_PROVIDER || 'gemini';

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new ProviderError('registry', `Provider desconocido: "${id}"`, {
      status: 400,
      code: 'UNKNOWN_PROVIDER',
    });
  }
  return provider;
}

/**
 * Devuelve un array describiendo cada provider y si está configurado.
 * Si `userId` se provee, además marca cuáles tienen una API key cargada
 * por ese user (independiente del env).
 */
export async function listProvidersStatus({ userId } = {}) {
  const userKeysByProvider = userId
    ? await loadUserKeysIndex(userId)
    : new Map();

  const entries = await Promise.all(
    Object.entries(PROVIDERS).map(async ([id, provider]) => ({
      id,
      label: provider.label,
      defaultModel: provider.defaultModel,
      configured:
        userKeysByProvider.has(id) ||
        (await provider.isConfigured().catch(() => false)),
      configuredByUser: userKeysByProvider.has(id),
      isDefault: id === DEFAULT_PROVIDER_ID,
    })),
  );
  return entries;
}

/**
 * Resuelve el provider + la API key a usar para un request.
 *
 * Prioridad:
 * 1. Key del user logueado (UserApiKey con isDefault=true para ese provider,
 *    o la más reciente si no hay default).
 * 2. Si AI_PROVIDER=auto: recorrer providers en orden, devolver el primero
 *    que tenga key (del user o del env).
 * 3. Fallback al env (modo legacy / admin sin auth).
 *
 * @returns {{ provider, apiKey: string|null }}
 */
export async function resolveProvider({ requestedId, userId } = {}) {
  const target = requestedId || DEFAULT_PROVIDER_ID;

  if (target === 'auto') {
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      // eslint-disable-next-line no-await-in-loop
      const userKey = userId ? await loadUserKey(userId, id) : null;
      if (userKey) return { provider, apiKey: userKey };
      // eslint-disable-next-line no-await-in-loop
      if (await provider.isConfigured()) return { provider, apiKey: null };
    }
    throw new ProviderError('registry', 'Ningún provider configurado', {
      status: 503,
      code: 'NO_PROVIDER_CONFIGURED',
    });
  }

  const provider = getProvider(target);
  const userKey = userId ? await loadUserKey(userId, target) : null;
  return { provider, apiKey: userKey };
}

/** Carga la API key default del user para un provider, descifrada. null si no hay. */
async function loadUserKey(userId, providerId) {
  const records = await prisma.userApiKey.findMany({
    where: { userId, provider: providerId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    take: 1,
    select: { encryptedKey: true },
  });
  if (records.length === 0) return null;
  try {
    return decrypt(records[0].encryptedKey);
  } catch (err) {
    console.error(`[providers] No se pudo descifrar key del user ${userId}/${providerId}:`, err?.message);
    return null;
  }
}

/** Devuelve un Map<providerId, true> con los providers que el user tiene cargados. */
async function loadUserKeysIndex(userId) {
  const records = await prisma.userApiKey.findMany({
    where: { userId },
    select: { provider: true },
    distinct: ['provider'],
  });
  const map = new Map();
  for (const r of records) map.set(r.provider, true);
  return map;
}
