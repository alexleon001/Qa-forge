// Provider OpenAI — usa response_format: json_schema con strict: true.
// Model default: gpt-4o-mini (barato y suficiente para esta tarea).

import OpenAI from 'openai';

import { ProviderError, parseJsonOutput } from './base.js';

const PROVIDER_ID = 'openai';
const DEFAULT_MODEL = process.env.AI_MODEL_OPENAI || 'gpt-4o-mini';

let clientRef = null;
function getClient() {
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
 * Para strict mode OpenAI requiere additionalProperties: false en todos los
 * objects (lo cumplimos en el schema base) y que todas las properties estén
 * en `required`. Ya lo cumple el schema, así que no hace falta sanitizar.
 */
export const openaiProvider = {
  id: PROVIDER_ID,
  label: 'OpenAI',
  defaultModel: DEFAULT_MODEL,

  async isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  async generateStructured({ system, user, schema, model }) {
    const client = getClient();
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
            schema,
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
      throw new ProviderError(PROVIDER_ID, err?.message ?? String(err), {
        status: err?.status ?? 502,
        cause: err,
      });
    }
  },
};
