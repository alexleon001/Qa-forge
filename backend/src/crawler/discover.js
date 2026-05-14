// Descubrimiento de URLs para el modo crawl. Estrategia en cascada:
//   1) Si existe /sitemap.xml (o /sitemap_index.xml) → parseamos y devolvemos
//      hasta `maxPages` URLs del mismo origin.
//   2) Si no, hacemos un capture inicial con Playwright en la URL base y
//      extraemos links internos del DOM, deduplicados.
// Siempre incluye la URL base como primer item.

import { MAX_CRAWL_PAGES } from '../../../shared/constants.js';
import { runPlaywrightCapture } from '../runners/playwright.runner.js';
import { runLoginPreflight } from '../runners/login.runner.js';

const SITEMAP_FETCH_TIMEOUT_MS = 8_000;
const MAX_SITEMAP_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {number} opts.maxPages — cap del usuario (clamp a MAX_CRAWL_PAGES)
 * @param {import('../queue/scan.queue.js').ScanContext} [opts.scanCtx]
 * @param {object} [opts.loginConfig]
 * @param {string} [opts.deviceProfile]
 * @returns {Promise<string[]>}
 */
export async function discoverCrawlUrls({
  baseUrl,
  maxPages,
  scanCtx,
  loginConfig,
  deviceProfile,
}) {
  const cap = clampPages(maxPages);
  const origin = new URL(baseUrl).origin;

  // 1) sitemap
  const fromSitemap = await tryFetchSitemap(origin, scanCtx).catch(() => []);
  const sameOrigin = fromSitemap.filter((u) => safeOrigin(u) === origin);
  if (sameOrigin.length > 0) {
    return dedupe([baseUrl, ...sameOrigin]).slice(0, cap);
  }

  // 2) fallback: capture inicial → links internos
  let storageState = null;
  if (loginConfig) {
    const loginResult = await runLoginPreflight({
      loginConfig,
      deviceProfile,
      scanCtx,
    });
    if (loginResult.status === 'pass' && loginResult.data?.storageState) {
      storageState = loginResult.data.storageState;
    }
  }
  const capture = await runPlaywrightCapture({
    url: baseUrl,
    scanCtx,
    deviceProfile,
    storageState,
  });
  if (capture.status !== 'pass' || !capture.data?.links) {
    return [baseUrl];
  }
  const links = capture.data.links
    .map((l) => resolveSameOrigin(baseUrl, l.href))
    .filter(Boolean);
  return dedupe([baseUrl, ...links]).slice(0, cap);
}

function clampPages(n) {
  const num = Number.isFinite(n) ? Math.floor(n) : 1;
  return Math.min(Math.max(num, 1), MAX_CRAWL_PAGES);
}

async function tryFetchSitemap(origin, scanCtx) {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  for (const url of candidates) {
    const xml = await fetchText(url, scanCtx).catch(() => null);
    if (!xml) continue;
    const urls = parseSitemap(xml);
    // Si es un sitemap index, expandimos un nivel (máx 3 sitemaps hijos para no escalar)
    if (urls.length === 0 && /<sitemapindex/i.test(xml)) {
      const subSitemaps = parseSitemapIndex(xml).slice(0, 3);
      const collected = [];
      for (const sub of subSitemaps) {
        const subXml = await fetchText(sub, scanCtx).catch(() => null);
        if (subXml) collected.push(...parseSitemap(subXml));
      }
      if (collected.length > 0) return collected;
    }
    if (urls.length > 0) return urls;
  }
  return [];
}

async function fetchText(url, scanCtx) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEMAP_FETCH_TIMEOUT_MS);
  // Encadenamos al abort del scan (si lo cancelan, abortamos esta fetch)
  const signalChain = scanCtx?.signal
    ? scanCtx.signal.addEventListener?.('abort', () => controller.abort())
    : null;
  void signalChain;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QAForgeBot/0.1; +crawler)' },
    });
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    let total = 0;
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_SITEMAP_BYTES) {
        reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

function parseSitemap(xml) {
  const out = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(decodeXmlEntities(m[1]));
  }
  return out;
}

function parseSitemapIndex(xml) {
  // Mismo regex pero el contexto es <sitemap><loc>...</loc></sitemap>
  return parseSitemap(xml);
}

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function safeOrigin(u) {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

function resolveSameOrigin(baseUrl, href) {
  if (!href) return null;
  // Descartamos anchors-only, mailto, tel, javascript
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
  try {
    const absolute = new URL(href, baseUrl);
    if (absolute.origin !== new URL(baseUrl).origin) return null;
    // Quitamos el hash para no contar #section como página distinta
    absolute.hash = '';
    return absolute.toString();
  } catch {
    return null;
  }
}

function dedupe(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}
