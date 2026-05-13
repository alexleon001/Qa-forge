// Provider Ollama — local, gratis, privado. Habla con http://localhost:11434.
// Ollama v0.5+ soporta JSON schema en el field `format` del endpoint /api/chat.

import { ProviderError, parseJsonOutput } from './base.js';

const PROVIDER_ID = 'ollama';
const DEFAULT_MODEL = process.env.AI_MODEL_OLLAMA || 'qwen2.5-coder:7b';
const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

/** Ping rápido a /api/tags para saber si Ollama está corriendo. */
async function ollamaIsRunning(timeoutMs = 1_500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${BASE_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

export const ollamaProvider = {
  id: PROVIDER_ID,
  label: 'Ollama (local)',
  defaultModel: DEFAULT_MODEL,

  async isConfigured() {
    return ollamaIsRunning();
  },

  async generateStructured({ system, user, schema, model }) {
    const useModel = model || DEFAULT_MODEL;

    // Ollama no tiene timeout default razonable; los modelos locales son lentos.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min

    try {
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: useModel,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          // Ollama acepta el JSON schema directamente en `format`.
          format: schema,
          options: {
            temperature: 0.4,
            num_ctx: 8192,
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new ProviderError(
          PROVIDER_ID,
          `Ollama respondió ${response.status}: ${body.slice(0, 200)}`,
          { status: 502 },
        );
      }

      const data = await response.json();
      const rawText = data?.message?.content ?? '';
      const parsed = parseJsonOutput(PROVIDER_ID, rawText);

      return {
        parsed,
        usage: {
          input_tokens: data.prompt_eval_count,
          output_tokens: data.eval_count,
          total_tokens:
            (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
        providerId: PROVIDER_ID,
        model: useModel,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err?.name === 'AbortError') {
        throw new ProviderError(PROVIDER_ID, 'Timeout esperando respuesta de Ollama (>5min)', {
          status: 504,
        });
      }
      throw new ProviderError(
        PROVIDER_ID,
        err?.message ?? String(err),
        { status: err?.code === 'ECONNREFUSED' ? 503 : 502, cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  },
};
