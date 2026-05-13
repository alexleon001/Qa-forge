// Verifica el status HTTP de cada link interno/externo capturado por Playwright.
// Limita concurrencia y total de links a chequear para no abusar.

import { DEFAULTS, RESULT_STATUS } from '../../../shared/constants.js';

const CONCURRENCY = 8;

/**
 * @param {{ captureData: any, baseUrl: string }} input
 */
export async function analyzeLinks({ captureData, baseUrl, scanCtx } = {}) {
  if (!captureData?.links?.length) {
    return {
      status: RESULT_STATUS.INFO,
      data: { checked: 0, total: 0, links: [] },
      error: null,
    };
  }

  // Resolver hrefs relativos y deduplicar.
  const base = new URL(baseUrl);
  const seen = new Set();
  const resolved = [];
  for (const link of captureData.links) {
    if (!link.href) continue;
    try {
      const abs = new URL(link.href, base).toString();
      if (seen.has(abs)) continue;
      // Saltar mailto:, tel:, javascript:, fragment-only
      if (/^(mailto:|tel:|javascript:|#)/i.test(link.href)) continue;
      seen.add(abs);
      resolved.push({ ...link, absolute: abs, internal: new URL(abs).host === base.host });
    } catch {
      // href inválido — lo reportamos como link roto
      resolved.push({ ...link, absolute: link.href, broken: true });
    }
  }

  const toCheck = resolved.slice(0, DEFAULTS.MAX_LINKS_TO_CHECK);
  const results = await runWithConcurrency(toCheck, CONCURRENCY, (link) =>
    checkLink(link, scanCtx),
  );

  const broken = results.filter((r) => r.status === 'broken' || (r.httpStatus && r.httpStatus >= 400));
  const slowOrRedirected = results.filter((r) => r.httpStatus >= 300 && r.httpStatus < 400);

  const status = broken.length > 0 ? RESULT_STATUS.FAIL
    : slowOrRedirected.length > 0 ? RESULT_STATUS.WARNING
      : RESULT_STATUS.PASS;

  return {
    status,
    data: {
      total: resolved.length,
      checked: toCheck.length,
      broken: broken.length,
      redirected: slowOrRedirected.length,
      ok: results.length - broken.length - slowOrRedirected.length,
      links: results,
    },
    error: null,
  };
}

async function checkLink(link, scanCtx) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULTS.HTTP_REQUEST_TIMEOUT_MS);
  const onCancel = () => controller.abort();
  scanCtx?.signal?.addEventListener('abort', onCancel, { once: true });
  try {
    // HEAD primero; si no soporta, fallback a GET.
    let response = await fetch(link.absolute, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'QAForgeBot/0.1 (+links-analyzer)' },
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(link.absolute, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'QAForgeBot/0.1 (+links-analyzer)' },
      });
    }
    return {
      href: link.absolute,
      text: link.text,
      internal: link.internal,
      httpStatus: response.status,
      status: response.status >= 400 ? 'broken' : 'ok',
    };
  } catch (err) {
    return {
      href: link.absolute,
      text: link.text,
      internal: link.internal,
      httpStatus: null,
      status: 'broken',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
    scanCtx?.signal?.removeEventListener?.('abort', onCancel);
  }
}

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      results[myIdx] = await fn(items[myIdx]);
    }
  });
  await Promise.all(workers);
  return results;
}
