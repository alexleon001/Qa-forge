// Provider OpenRouter — reusa el SDK de OpenAI con baseURL custom.
// Soporta Llama, DeepSeek, Qwen, Mistral, etc. Una sola API key, pay-per-use.

import OpenAI from 'openai';

import { ProviderError, parseJsonOutput } from './base.js';

const PROVIDER_ID = 'openrouter';
const DEFAULT_MODEL = process.env.AI_MODEL_OPENROUTER || 'meta-llama/llama-3.3-70b-instruct';

let clientRef = null;
function getClient() {
  if (clientRef) return clientRef;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new ProviderError(PROVIDER_ID, 'OPENROUTER_API_KEY no seteada', {
      status: 503,
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }
  clientRef = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      // OpenRouter recomienda estos headers para identificar la app (opcional).
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:5173',
      'X-Title': 'QA Forge',
    },
  });
  return clientRef;
}

export const openrouterProvider = {
  id: PROVIDER_ID,
  label: 'OpenRouter',
  defaultModel: DEFAULT_MODEL,

  async isConfigured() {
    return Boolean(process.env.OPENROUTER_API_KEY);
  },

  async generateStructured({ system, user, schema, model }) {
    const client = getClient();
    const useModel = model || DEFAULT_MODEL;

    // El soporte de response_format varía por modelo en OpenRouter. Pedimos
    // json_object (modo JSON laxo) y reforzamos con prompt — más compatible.
    // Si el modelo soporta json_schema, también funcionará.
    const augmentedSystem = `${system}\n\nIMPORTANTE: Responder ÚNICAMENTE con un JSON válido conforme a este schema (sin texto extra, sin comentarios, sin markdown):\n${JSON.stringify(
      schema,
    )}`;

    try {
      const completion = await client.chat.completions.create({
        model: useModel,
        messages: [
          { role: 'system', content: augmentedSystem },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 16_000,
        temperature: 0.4,
      });

      const rawText = completion.choices?.[0]?.message?.content;
      const parsed = parseJsonOutput(PROVIDER_ID, rawText);

      return {
        parsed,
        usage: completion.usage
          ? {
              input_tokens: completion.usage.prompt_tokens,
              output_tokens: completion.usage.completion_tokens,
              total_tokens: completion.usage.total_tokens,
            }
          : null,
        providerId: PROVIDER_ID,
        model: useModel,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(PROVIDER_ID, err?.message ?? String(err), {
        status: err?.status ?? 502,
        cause: err,
      });
    }
  },
};
