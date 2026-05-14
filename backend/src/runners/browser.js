// Helper centralizado para elegir engine de Playwright (chromium|firefox|webkit).
// Único punto que conoce los 3 módulos — los runners llaman launchBrowser() y
// se olvidan del engine concreto.

import { chromium, firefox, webkit } from 'playwright';

import { DEFAULT_BROWSER_ENGINE } from '../../../shared/constants.js';

const ENGINES = { chromium, firefox, webkit };

/**
 * Lanza un browser de Playwright respetando el engine pedido. Para chromium,
 * sigue honrando PLAYWRIGHT_CHANNEL (Chrome/Edge en sistemas donde el
 * chrome-headless-shell bundled da problemas, ej. Bun en Windows).
 *
 * @param {string} engineId — 'chromium' | 'firefox' | 'webkit'
 * @param {object} [launchOptions]
 */
export function launchBrowser(engineId, launchOptions = {}) {
  const id = ENGINES[engineId] ? engineId : DEFAULT_BROWSER_ENGINE;
  const engine = ENGINES[id];
  const opts = { headless: true, ...launchOptions };
  // `channel` solo es válido en Chromium. Firefox/WebKit explotan si lo reciben.
  if (id === 'chromium' && !opts.channel) {
    const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;
    if (channel) opts.channel = channel;
  } else if (id !== 'chromium') {
    delete opts.channel;
  }
  return engine.launch(opts);
}

export function resolveEngine(engineId) {
  return ENGINES[engineId] ? engineId : DEFAULT_BROWSER_ENGINE;
}
