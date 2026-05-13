// Provider OpenRouter — reusa el SDK de OpenAI con baseURL custom.
// Soporta Llama, DeepSeek, Qwen, Mistral, etc. Una sola API key, pay-per-use.

import OpenAI from 'openai';

import { ProviderError, parseJsonOutput } from './base.js';

const PROVIDER_ID = 'openrouter';
const DEFAULT_MODEL = process.env.AI_MODEL_OPENROUTER || 'meta-llama/llama-3.3-70b-instruct';

function buildClient(apiKey) {
  return new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:5173',
      'X-Title': 'QA Forge',
    },
  });
}

let clientRef = null;
function getClient(runtimeApiKey) {
  if (runtimeApiKey) return buildClient(runtimeApiKey);
  if (clientRef) return clientRef;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new ProviderError(PROVIDER_ID, 'OPENROUTER_API_KEY no seteada', {
      status: 503,
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }
  clientRef = buildClient(apiKey);
  return clientRef;
}

export const openrouterProvider = {
  id: PROVIDER_ID,
  label: 'OpenRouter',
  defaultModel: DEFAULT_MODEL,

  async isConfigured() {
    return Boolean(process.env.OPENROUTER_API_KEY);
  },

  async generateStructured({ system, user, schema, model, apiKey }) {
    const client = getClient(apiKey);
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
      const friendly = parseOpenRouterError(err, useModel);
      throw new ProviderError(PROVIDER_ID, friendly.message, {
        status: friendly.status,
        code: friendly.code,
        cause: err,
      });
    }
  },
};

/** Normaliza errores del SDK de OpenAI (que OpenRouter usa) a mensajes claros. */
function parseOpenRouterError(err, model) {
  const status = err?.status ?? err?.response?.status ?? 502;
  const isFreeModel = /:free$/.test(model || '');

  if (status === 429) {
    return {
      status: 429,
      code: 'QUOTA_EXCEEDED',
      message: isFreeModel
        ? `Rate limit del modelo gratuito "${model}". Los modelos :free en OpenRouter están en cola compartida globalmente. Esperá 30-60s y reintentá, probá otro modelo :free, o agregá $5 de crédito en openrouter.ai/credits para acceso priority.`
        : `Rate limit alcanzado en OpenRouter. Esperá unos segundos y reintentá.`,
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 401,
      code: 'INVALID_API_KEY',
      message:
        'API key de OpenRouter inválida o sin permisos. Verificá OPENROUTER_API_KEY en Railway.',
    };
  }
  if (status === 402) {
    return {
      status: 402,
      code: 'INSUFFICIENT_CREDITS',
      message:
        'OpenRouter: créditos insuficientes para este modelo. Agregá crédito en openrouter.ai/credits o usá un modelo :free.',
    };
  }
  if (status === 404) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      message: `Modelo "${model}" no existe en OpenRouter. Verificá el ID exacto en openrouter.ai/models.`,
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 502,
    code: 'PROVIDER_ERROR',
    message: err?.message ?? String(err).slice(0, 500),
  };
}
