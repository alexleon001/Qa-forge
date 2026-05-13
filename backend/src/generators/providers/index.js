// Registry de providers + selección por env / request.

import { anthropicProvider } from './anthropic.provider.js';
import { geminiProvider } from './gemini.provider.js';
import { ollamaProvider } from './ollama.provider.js';
import { openaiProvider } from './openai.provider.js';
import { openrouterProvider } from './openrouter.provider.js';
import { ProviderError } from './base.js';

/** Orden de listado (también orden de auto-fallback si AI_PROVIDER=auto). */
export const PROVIDERS = Object.freeze({
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
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
 * El frontend lo usa para mostrar solo los disponibles en el dropdown.
 */
export async function listProvidersStatus() {
  const entries = await Promise.all(
    Object.entries(PROVIDERS).map(async ([id, provider]) => ({
      id,
      label: provider.label,
      defaultModel: provider.defaultModel,
      configured: await provider.isConfigured().catch(() => false),
      isDefault: id === DEFAULT_PROVIDER_ID,
    })),
  );
  return entries;
}

/**
 * Resuelve el provider a usar para un request:
 * 1. Si el body manda `provider`, usar ese.
 * 2. Si no, usar AI_PROVIDER (default: gemini).
 * 3. Si está configurado como 'auto', recorrer en orden y devolver el primero configurado.
 */
export async function resolveProvider({ requestedId } = {}) {
  const target = requestedId || DEFAULT_PROVIDER_ID;
  if (target === 'auto') {
    for (const provider of Object.values(PROVIDERS)) {
      // eslint-disable-next-line no-await-in-loop
      if (await provider.isConfigured()) return provider;
    }
    throw new ProviderError('registry', 'Ningún provider configurado', {
      status: 503,
      code: 'NO_PROVIDER_CONFIGURED',
    });
  }
  return getProvider(target);
}
