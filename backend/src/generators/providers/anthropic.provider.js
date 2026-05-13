// Provider Anthropic Claude — usa @anthropic-ai/sdk con output_config JSON schema,
// adaptive thinking + effort medium, y prompt caching en el system prompt.

import Anthropic from '@anthropic-ai/sdk';

import { CLAUDE_MODEL } from '../../../../shared/constants.js';
import { ProviderError, parseJsonOutput } from './base.js';

const PROVIDER_ID = 'anthropic';
const DEFAULT_MODEL = CLAUDE_MODEL;

let clientRef = null;
function getClient() {
  if (clientRef) return clientRef;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ProviderError(PROVIDER_ID, 'ANTHROPIC_API_KEY no seteada', {
      status: 503,
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }
  clientRef = new Anthropic({ apiKey });
  return clientRef;
}

export const anthropicProvider = {
  id: PROVIDER_ID,
  label: 'Anthropic Claude',
  defaultModel: DEFAULT_MODEL,

  async isConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  async generateStructured({ system, user, schema, model }) {
    const client = getClient();
    const useModel = model || DEFAULT_MODEL;
    try {
      const response = await client.messages.create({
        model: useModel,
        max_tokens: 16_000,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema },
        },
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: user }],
      });

      let parsed = null;
      if (response.parsed_output && typeof response.parsed_output === 'object') {
        parsed = response.parsed_output;
      } else {
        const textBlock = response.content?.find((b) => b.type === 'text');
        parsed = parseJsonOutput(PROVIDER_ID, textBlock?.text);
      }

      return {
        parsed,
        usage: response.usage,
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
