// Provider OpenAI — usa response_format: json_schema con strict: true.
// Model default: gpt-4o-mini (barato y suficiente para esta tarea).

import OpenAI from 'openai';

import { ProviderError, parseJsonOutput } from './base.js';

const PROVIDER_ID = 'openai';
const DEFAULT_MODEL = process.env.AI_MODEL_OPENAI || 'gpt-4o-mini';

let clientRef = null;
function getClient(runtimeApiKey) {
  if (runtimeApiKey) return new OpenAI({ apiKey: runtimeApiKey });
  if (clientRef) return clientRef;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError(PROVIDER_ID, 'OPENAI_API_KEY no seteada', {
      status: 503,
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }
  clientRef = new OpenAI({ apiKey });
  return clientRef;
}

/**
 * OpenAI strict mode (response_format: json_schema) impone reglas rígidas:
 * 1. additionalProperties: false en todos los objects.
 * 2. TODAS las properties deben estar en `required`. No hay "opcional" como tal.
 * 3. Para simular opcional, el type debe ser union con null: ["string", "null"].
 *
 * Esta función toma un schema con required parcial y lo expande:
 * - los properties que NO estaban en `required` original quedan agregados a
 *   `required` pero con type union ["X", "null"].
 * - aplicación recursiva (objects anidados, arrays.items).
 */
function sanitizeSchemaForOpenAI(schema) {
  if (schema == null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForOpenAI);

  const out = { ...schema };
  if (out.type === 'object' && out.properties) {
    const props = {};
    const originalRequired = new Set(Array.isArray(out.required) ? out.required : []);
    const allKeys = Object.keys(out.properties);

    for (const key of allKeys) {
      const subSchema = sanitizeSchemaForOpenAI(out.properties[key]);
      if (!originalRequired.has(key)) {
        // Convertir a nullable union: type puede ser string o array.
        if (typeof subSchema.type === 'string') {
          subSchema.type = [subSchema.type, 'null'];
        } else if (Array.isArray(subSchema.type) && !subSchema.type.includes('null')) {
          subSchema.type = [...subSchema.type, 'null'];
        }
      }
      props[key] = subSchema;
    }

    out.properties = props;
    out.required = allKeys; // strict exige todas
    out.additionalProperties = false;
  } else if (out.type === 'array' && out.items) {
    out.items = sanitizeSchemaForOpenAI(out.items);
  } else {
    // Caso genérico: recursar en sub-valores.
    for (const [k, v] of Object.entries(out)) {
      if (v && typeof v === 'object') {
        out[k] = sanitizeSchemaForOpenAI(v);
      }
    }
  }
  return out;
}

export const openaiProvider = {
  id: PROVIDER_ID,
  label: 'OpenAI (ChatGPT)',
  defaultModel: DEFAULT_MODEL,

  async isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  async generateStructured({ system, user, schema, model, apiKey }) {
    const client = getClient(apiKey);
    const useModel = model || DEFAULT_MODEL;
    try {
      const completion = await client.chat.completions.create({
        model: useModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'qa_forge_scripts',
            strict: true,
            schema: sanitizeSchemaForOpenAI(schema),
          },
        },
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
      const friendly = parseOpenAIError(err);
      throw new ProviderError(PROVIDER_ID, friendly.message, {
        status: friendly.status,
        code: friendly.code,
        cause: err,
      });
    }
  },
};

function parseOpenAIError(err) {
  const status = err?.status ?? err?.response?.status ?? 502;
  if (status === 429) {
    return {
      status: 429,
      code: 'QUOTA_EXCEEDED',
      message: 'Rate limit de OpenAI. Esperá unos segundos y reintentá.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 401,
      code: 'INVALID_API_KEY',
      message:
        'OPENAI_API_KEY inválida o sin permisos. Verificá en platform.openai.com/api-keys.',
    };
  }
  if (status === 402 || /insufficient_quota/i.test(err?.message ?? '')) {
    return {
      status: 402,
      code: 'INSUFFICIENT_CREDITS',
      message:
        'Créditos OpenAI agotados. Cargá saldo en platform.openai.com/account/billing.',
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 502,
    code: 'PROVIDER_ERROR',
    message: err?.message ?? String(err).slice(0, 500),
  };
}
