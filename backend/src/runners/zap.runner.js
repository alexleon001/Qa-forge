// Runner de OWASP ZAP (#14). Orquesta un scan de seguridad contra una URL usando
// un daemon ZAP externo (zap.client). Según el modo corre: spider (crawl) →
// passive scan (análisis no intrusivo) → active scan (envía ataques, solo `full`).
// Pollea el progreso de cada fase, emite avances por callback y al final junta las
// alertas agrupadas por riesgo. No bloquea: todo es polling con deadlines duros.

import {
  getAlerts,
  passiveRecordsToScan,
  spiderResults,
  spiderStatus,
  startActiveScan,
  startSpider,
  activeScanStatus,
  ZapError,
} from '../integrations/zap.client.js';
import { SCAN_STATUS, ZAP_RISK_LEVELS, ZAP_SCAN_MODES } from '../../../shared/constants.js';

const POLL_INTERVAL_MS = 3_000;
const SPIDER_MAX_MS = 5 * 60_000;
const PASSIVE_MAX_MS = 5 * 60_000;
const ACTIVE_MAX_MS = 30 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ scan, config, ctx, onProgress }} args  config = { apiUrl, apiKey }
 * @returns {Promise<{ status, alerts, summary, phase, errorMessage }>}
 */
export async function runZapScan({ scan, config, ctx, onProgress } = {}) {
  const modeMeta = ZAP_SCAN_MODES[scan.mode] ?? ZAP_SCAN_MODES.baseline;
  const url = scan.url;
  let urlsFound = 0;

  try {
    // ── 1) Spider ────────────────────────────────────────────────────────────
    onProgress?.({ phase: 'spider', message: 'Iniciando spider…', spiderProgress: 0 });
    const spiderId = await startSpider(config, url);
    if (spiderId == null) throw new ZapError(502, 'NO_SPIDER', 'ZAP no devolvió scanId de spider');

    const spiderDeadline = Date.now() + SPIDER_MAX_MS;
    for (;;) {
      await ctx?.checkCancellation?.();
      const pct = await spiderStatus(config, spiderId);
      onProgress?.({ phase: 'spider', message: `Spider ${pct}%`, spiderProgress: pct });
      if (pct >= 100) break;
      if (Date.now() > spiderDeadline) throw new ZapError(504, 'SPIDER_TIMEOUT', 'Spider excedió el tiempo máximo');
      await sleep(POLL_INTERVAL_MS);
    }
    urlsFound = (await spiderResults(config, spiderId).catch(() => [])).length;

    // ── 2) Passive scan (baseline + full) ─────────────────────────────────────
    if (scan.mode !== 'spider') {
      onProgress?.({ phase: 'passive', message: 'Esperando passive scan…', spiderProgress: 100 });
      const passiveDeadline = Date.now() + PASSIVE_MAX_MS;
      for (;;) {
        await ctx?.checkCancellation?.();
        const remaining = await passiveRecordsToScan(config);
        onProgress?.({ phase: 'passive', message: `Passive scan: ${remaining} registros restantes` });
        if (remaining <= 0) break;
        if (Date.now() > passiveDeadline) break; // no fatal: seguimos con lo que haya
        await sleep(POLL_INTERVAL_MS);
      }
    }

    // ── 3) Active scan (solo full — INTRUSIVO) ────────────────────────────────
    if (modeMeta.active) {
      onProgress?.({ phase: 'active', message: 'Iniciando active scan (intrusivo)…', activeProgress: 0 });
      const ascanId = await startActiveScan(config, url);
      if (ascanId != null) {
        const activeDeadline = Date.now() + ACTIVE_MAX_MS;
        for (;;) {
          await ctx?.checkCancellation?.();
          const pct = await activeScanStatus(config, ascanId);
          onProgress?.({ phase: 'active', message: `Active scan ${pct}%`, activeProgress: pct });
          if (pct >= 100) break;
          if (Date.now() > activeDeadline) throw new ZapError(504, 'ASCAN_TIMEOUT', 'Active scan excedió el tiempo máximo');
          await sleep(POLL_INTERVAL_MS);
        }
      }
    }

    // ── 4) Alertas + resumen ──────────────────────────────────────────────────
    onProgress?.({ phase: 'done', message: 'Recolectando alertas…' });
    const alerts = await getAlerts(config, url);
    const summary = summarize(alerts, urlsFound);
    return { status: SCAN_STATUS.COMPLETED, alerts, summary, phase: 'done', errorMessage: null };
  } catch (err) {
    const message = err instanceof ZapError ? err.message : (err?.message ?? String(err));
    // Si fue cancelación, que el caller la maneje (no la convertimos en "failed").
    if (err?.isCancellation || err?.name === 'AbortError') throw err;
    return { status: SCAN_STATUS.FAILED, alerts: [], summary: summarize([], urlsFound), phase: null, errorMessage: message };
  }
}

function summarize(alerts, urlsFound) {
  const byRisk = {};
  for (const r of ZAP_RISK_LEVELS) byRisk[r] = 0;
  for (const a of alerts) {
    if (byRisk[a.risk] != null) byRisk[a.risk] += 1;
    else byRisk[a.risk] = 1;
  }
  return { byRisk, total: alerts.length, urlsFound };
}
