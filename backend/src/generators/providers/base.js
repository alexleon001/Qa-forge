// Interfaz común de providers de IA para QA Forge.
// Cada provider implementa generateStructured() y devuelve el mismo shape.

/**
 * @typedef {Object} ProviderInput
 * @property {string} system        - System prompt (frozen, idem para todos los providers).
 * @property {string} user          - User message con la data del scan.
 * @property {object} schema        - JSON schema del output esperado.
 * @property {string} [model]       - Override del modelo default del provider.
 */

/**
 * @typedef {Object} ProviderOutput
 * @property {object} parsed                 - JSON parseado conforme al schema.
 * @property {object} [usage]                - { input_tokens, output_tokens, ... } si el provider lo expone.
 * @property {string} [rawText]              - Texto crudo (debug).
 * @property {string} providerId             - ID del provider que respondió.
 * @property {string} model                  - Modelo usado.
 */

/**
 * @typedef {Object} ProviderDescriptor
 * @property {string} id                     - 'anthropic' | 'gemini' | 'openai' | 'openrouter' | 'ollama'
 * @property {string} label                  - Nombre legible para la UI.
 * @property {string} defaultModel           - Modelo por defecto.
 * @property {() => Promise<boolean>} isConfigured  - True si el provider puede operar (env presente / endpoint accesible).
 * @property {(input: ProviderInput) => Promise<ProviderOutput>} generateStructured
 */

/**
 * Helper para crear errores tipados desde cualquier provider.
 */
export class ProviderError extends Error {
  constructor(providerId, message, { status = 502, code = 'PROVIDER_ERROR', cause } = {}) {
    super(`[${providerId}] ${message}`);
    this.providerId = providerId;
    this.status = status;
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * Intenta parsear el output del LLM como JSON. Si viene envuelto en ```json …```
 * o con texto extra alrededor, recorta. Si nada parsea, lanza ProviderError.
 */
export function parseJsonOutput(providerId, rawText) {
  if (!rawText) {
    throw new ProviderError(providerId, 'Respuesta vacía del modelo');
  }
  try {
    return JSON.parse(rawText);
  } catch {
    // ```json … ```
    const fenced = /```(?:json)?\s*([\s\S]+?)```/m.exec(rawText);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // sigue
      }
    }
    // Primer {…} balanceado
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(rawText.slice(start, end + 1));
      } catch {
        // sigue
      }
    }
    throw new ProviderError(providerId, 'El modelo no devolvió un JSON parseable', {
      code: 'INVALID_LLM_RESPONSE',
    });
  }
}
