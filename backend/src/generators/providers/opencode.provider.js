// Provider opencode Zen — gateway de modelos curados para coding agents.
// API OpenAI-compatible (https://opencode.ai/zen/v1), auth Bearer con la key
// `sk-...` de la suscripción. Reusa el SDK de OpenAI con baseURL custom, igual
// que el provider de OpenRouter.

import OpenAI from 'openai';

import { ProviderError, parseJsonOutput } from './base.js';

const PROVIDER_ID = 'opencode';
const DEFAULT_MODEL = process.env.AI_MODEL_OPENCODE || 'claude-sonnet-4-5';
const BASE_URL = process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1';

function buildClient(apiKey) {
  return new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    defaultHeaders: { 'X-Title': 'QA Forge' },
  });
}

let clientRef = null;
function getClient(runtimeApiKey) {
  if (runtimeApiKey) return buildClient(runtimeApiKey);
  if (clientRef) return clientRef;
  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey) {
    throw new ProviderError(PROVIDER_ID, 'OPENCODE_API_KEY no seteada', {
      status: 503,
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }
  clientRef = buildClient(apiKey);
  return clientRef;
}

export const opencodeProvider = {
  id: PROVIDER_ID,
  label: 'opencode Zen',
  defaultModel: DEFAULT_MODEL,

  async isConfigured() {
    return Boolean(process.env.OPENCODE_API_KEY);
  },

  async generateStructured({ system, user, schema, model, apiKey }) {
    const client = getClient(apiKey);
    const useModel = model || DEFAULT_MODEL;

    // El soporte de response_format varía según el modelo al que rutee el
    // gateway. Reforzamos siempre con prompt; el `json_object` es best-effort
    // (si el modelo lo rechaza, reintentamos sin él — ver catch abajo).
    const augmentedSystem = `${system}\n\nIMPORTANTE: Responder ÚNICAMENTE con un JSON válido conforme a este schema (sin texto extra, sin comentarios, sin markdown):\n${JSON.stringify(
      schema,
    )}`;
    const messages = [
      { role: 'system', content: augmentedSystem },
      { role: 'user', content: user },
    ];
    const baseParams = { model: useModel, messages, max_tokens: 16_000, temperature: 0.4 };

    let completion;
    try {
      completion = await client.chat.completions.create({
        ...baseParams,
        response_format: { type: 'json_object' },
      });
    } catch (err) {
      // Si el modelo/gateway no soporta response_format, reintentar sin él.
      const status = err?.status ?? err?.response?.status;
      if (status === 400 || status === 422) {
        try {
          completion = await client.chat.completions.create(baseParams);
        } catch (retryErr) {
          throw toProviderError(retryErr, useModel);
        }
      } else {
        throw toProviderError(err, useModel);
      }
    }

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
  },
};

/** Envuelve un error del SDK como ProviderError con mensaje claro. */
function toProviderError(err, model) {
  if (err instanceof ProviderError) return err;
  const friendly = parseOpencodeError(err, model);
  return new ProviderError(PROVIDER_ID, friendly.message, {
    status: friendly.status,
    code: friendly.code,
    cause: err,
  });
}

/** Normaliza errores del SDK de OpenAI (que opencode Zen usa) a mensajes claros. */
function parseOpencodeError(err, model) {
  const status = err?.status ?? err?.response?.status ?? 502;

  if (status === 429) {
    return {
      status: 429,
      code: 'QUOTA_EXCEEDED',
      message:
        'Rate limit alcanzado en opencode Zen. Esperá unos segundos y reintentá, o probá otro modelo.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 401,
      code: 'INVALID_API_KEY',
      message:
        'API key de opencode Zen inválida o sin permisos. Generá una nueva en opencode.ai/zen → Claves API.',
    };
  }
  if (status === 402) {
    return {
      status: 402,
      code: 'INSUFFICIENT_CREDITS',
      message:
        'opencode Zen: créditos/saldo insuficiente. Revisá Facturación en tu cuenta de opencode.',
    };
  }
  if (status === 404) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      message: `Modelo "${model}" no disponible en opencode Zen. Verificá el ID en opencode.ai/zen.`,
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 502,
    code: 'PROVIDER_ERROR',
    message: err?.message ?? String(err).slice(0, 500),
  };
}
