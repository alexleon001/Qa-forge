// Runner principal de Playwright: navega la URL y captura DOM, screenshot,
// links, forms y meta tags. Devuelve { status, data, error }.

import { chromium } from 'playwright';
import { DEFAULTS, RESULT_STATUS } from '../../../shared/constants.js';

/**
 * @param {{ url: string, onStage?: (stage: string) => void, scanCtx?: import('../queue/scan.queue.js').ScanContext }} opts
 */
export async function runPlaywrightCapture({ url, onStage, scanCtx } = {}) {
  let browser;
  try {
    onStage?.('launching_browser');
    // En Windows + Bun, el transporte por pipe del chrome-headless-shell falla.
    // Usar el canal `chrome` o `msedge` evita el binario problemático.
    const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;
    browser = await chromium.launch({ headless: true, channel });
    // Permitir cancelación: si llega un cancel, cerramos el browser y page.goto
    // termina con error inmediato en vez de esperar el timeout completo.
    scanCtx?.registerCleanup(async () => {
      try {
        await browser?.close();
      } catch {}
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (compatible; QAForgeBot/0.1; +https://github.com/qa-forge)',
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();

    onStage?.('capturing_dom');
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULTS.PLAYWRIGHT_TIMEOUT_MS,
    });

    if (!response) {
      return {
        status: RESULT_STATUS.FAIL,
        data: null,
        error: 'No se recibió respuesta del servidor',
      };
    }

    // Esperar un poco a recursos asíncronos clave, sin bloquear si son lentos.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    const html = await page.content();
    const title = await page.title();
    const screenshot = await page.screenshot({ fullPage: false, type: 'png' });

    // Extracción de metadata, links y forms desde el DOM.
    const extracted = await page.evaluate(() => {
      const meta = {};
      for (const el of document.querySelectorAll('meta')) {
        const name = el.getAttribute('name') || el.getAttribute('property');
        const content = el.getAttribute('content');
        if (name && content) meta[name] = content;
      }

      const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: a.getAttribute('href'),
        text: (a.textContent || '').trim().slice(0, 120),
        rel: a.getAttribute('rel') || null,
        target: a.getAttribute('target') || null,
      }));

      const forms = Array.from(document.querySelectorAll('form')).map((form) => ({
        action: form.getAttribute('action') || null,
        method: (form.getAttribute('method') || 'GET').toUpperCase(),
        id: form.id || null,
        name: form.getAttribute('name') || null,
        inputs: Array.from(form.querySelectorAll('input, textarea, select')).map((inp) => ({
          tag: inp.tagName.toLowerCase(),
          type: inp.getAttribute('type') || null,
          name: inp.getAttribute('name') || null,
          id: inp.id || null,
          required: inp.hasAttribute('required'),
          placeholder: inp.getAttribute('placeholder') || null,
        })),
      }));

      const headings = {
        h1: Array.from(document.querySelectorAll('h1')).map((h) => h.textContent?.trim()),
        h2: Array.from(document.querySelectorAll('h2')).map((h) => h.textContent?.trim()),
      };

      return { meta, links, forms, headings, htmlLang: document.documentElement.lang || null };
    });

    return {
      status: RESULT_STATUS.PASS,
      data: {
        url,
        finalUrl: page.url(),
        httpStatus: response.status(),
        title,
        htmlLang: extracted.htmlLang,
        html, // crudo — usado por analyzers posteriores
        screenshot: screenshot.toString('base64'),
        meta: extracted.meta,
        links: extracted.links,
        forms: extracted.forms,
        headings: extracted.headings,
      },
      error: null,
    };
  } catch (err) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
