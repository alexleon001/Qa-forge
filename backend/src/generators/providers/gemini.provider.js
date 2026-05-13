// Provider Google Gemini — @google/genai, responseMimeType: application/json + responseSchema.
// Free tier de Gemini 2.0 Flash: ~15 RPM / 1500 reqs/día.

import { GoogleGenAI } from '@google/genai';

import { ProviderError, parseJsonOutput } from './base.js';

const PROVIDER_ID = 'gemini';
const DEFAULT_MODEL = process.env.AI_MODEL_GEMINI || 'gemini-2.0-flash';

function getApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

let clientRef = null;
function getClient(runtimeApiKey) {
  // Si llega una key específica (del user logueado), creamos cliente efímero.
  if (runtimeApiKey) return new GoogleGenAI({ apiKey: runtimeApiKey });
  if (clientRef) return clientRef;
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new ProviderError(
      PROVIDER_ID,
      'GEMINI_API_KEY (o GOOGLE_API_KEY) no seteada',
      { status: 503, code: 'PROVIDER_NOT_CONFIGURED' },
    );
  }
  clientRef = new GoogleGenAI({ apiKey });
  return clientRef;
}

/**
 * Gemini acepta JSON Schema con limitaciones: no soporta `additionalProperties`
 * (lo ignora o falla según la versión). Sanitizamos antes de enviar.
 */
function sanitizeSchemaForGemini(schema) {
  if (schema == null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = sanitizeSchemaForGemini(v);
  }
  return out;
}

/** Normaliza errores del SDK de Gemini a mensajes claros para la UI. */
function parseGeminiError(err) {
  const raw = err?.message ?? String(err);
  // El SDK serializa el body como {"error":{...}}.
  let body = null;
  const jsonStart = raw.indexOf('{');
  if (jsonStart !== -1) {
    try {
      body = JSON.parse(raw.slice(jsonStart));
    } catch {}
  }
  const apiError = body?.error;
  const status = apiError?.code ?? err?.status ?? 502;
  if (status === 429) {
    const retryDelay =
      apiError?.details?.find?.((d) => d['@type']?.includes('RetryInfo'))?.retryDelay;
    return {
      status: 429,
      code: 'QUOTA_EXCEEDED',
      message:
        `Cuota de Gemini agotada. ${
          retryDelay ? `Reintentar en ${retryDelay}. ` : ''
        }Probá con otro provider (dropdown) o creá una nueva API key en https://aistudio.google.com/apikey (en un proyecto nuevo).`,
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 401,
      code: 'INVALID_API_KEY',
      message:
        'API key de Gemini inválida o sin permisos. Verificá GEMINI_API_KEY en Railway.',
    };
  }
  if (status === 400 && /API key/i.test(apiError?.message ?? '')) {
    return {
      status: 401,
      code: 'INVALID_API_KEY',
      message: 'API key de Gemini inválida. Generá una nueva en aistudio.google.com/apikey.',
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 502,
    code: 'PROVIDER_ERROR',
    message: apiError?.message ?? raw.slice(0, 500),
  };
}

export const geminiProvider = {
  id: PROVIDER_ID,
  label: 'Google Gemini',
  defaultModel: DEFAULT_MODEL,

  async isConfigured() {
    return Boolean(getApiKey());
  },

  async generateStructured({ system, user, schema, model, apiKey }) {
    const client = getClient(apiKey);
    const useModel = model || DEFAULT_MODEL;
    const cleanSchema = sanitizeSchemaForGemini(schema);

    try {
      const response = await client.models.generateContent({
        model: useModel,
        contents: [{ role: 'user', parts: [{ text: user }] }],
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseSchema: cleanSchema,
          maxOutputTokens: 16_000,
          temperature: 0.4,
        },
      });

      const rawText = response.text;
      const parsed = parseJsonOutput(PROVIDER_ID, rawText);

      const usageMeta = response.usageMetadata || {};
      return {
        parsed,
        usage: {
          input_tokens: usageMeta.promptTokenCount,
          output_tokens: usageMeta.candidatesTokenCount,
          total_tokens: usageMeta.totalTokenCount,
        },
        providerId: PROVIDER_ID,
        model: useModel,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const friendly = parseGeminiError(err);
      throw new ProviderError(PROVIDER_ID, friendly.message, {
        status: friendly.status,
        code: friendly.code,
        cause: err,
      });
    }
  },
};
