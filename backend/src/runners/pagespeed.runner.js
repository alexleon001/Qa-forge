// Llama a Google PageSpeed Insights API y extrae scores por categoría.
// Funciona sin API key (tier público con rate limit estricto), o con
// PAGESPEED_API_KEY en .env para subir el rate limit.

import { DEFAULTS, RESULT_STATUS } from '../../../shared/constants.js';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CATEGORIES = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'];

export async function runPageSpeedCheck({ url, strategy = 'mobile' } = {}) {
  try {
    const params = new URLSearchParams({ url, strategy });
    for (const cat of CATEGORIES) params.append('category', cat);
    const apiKey = process.env.PAGESPEED_API_KEY;
    if (apiKey) params.set('key', apiKey);

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DEFAULTS.PAGESPEED_TIMEOUT_MS,
    );
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text();
      return {
        status: RESULT_STATUS.FAIL,
        data: { httpStatus: response.status, body: body.slice(0, 500) },
        error: `PageSpeed respondió ${response.status}`,
      };
    }

    const json = await response.json();
    const categories = json?.lighthouseResult?.categories ?? {};
    const scores = {
      performance: toScore(categories.performance?.score),
      accessibility: toScore(categories.accessibility?.score),
      bestPractices: toScore(categories['best-practices']?.score),
      seo: toScore(categories.seo?.score),
    };

    // Vitals importantes
    const audits = json?.lighthouseResult?.audits ?? {};
    const vitals = {
      lcp: audits['largest-contentful-paint']?.displayValue ?? null,
      fcp: audits['first-contentful-paint']?.displayValue ?? null,
      cls: audits['cumulative-layout-shift']?.displayValue ?? null,
      tbt: audits['total-blocking-time']?.displayValue ?? null,
      tti: audits['interactive']?.displayValue ?? null,
      speedIndex: audits['speed-index']?.displayValue ?? null,
    };

    // Status global basado en el score de performance (criterio primario aquí).
    const status = pickStatus(scores.performance);

    return {
      status,
      data: { strategy, scores, vitals, finalUrl: json?.lighthouseResult?.finalUrl ?? url },
      error: null,
    };
  } catch (err) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function toScore(raw) {
  if (raw == null) return null;
  return Math.round(raw * 100);
}

function pickStatus(perfScore) {
  if (perfScore == null) return RESULT_STATUS.INFO;
  if (perfScore < 50) return RESULT_STATUS.FAIL;
  if (perfScore < 90) return RESULT_STATUS.WARNING;
  return RESULT_STATUS.PASS;
}

// Marker para tests/imports — DEFAULTS no se usa aquí pero lo dejamos disponible.
export const _exposeDefaults = DEFAULTS;
