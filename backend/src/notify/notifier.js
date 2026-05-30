// Notificaciones para scans disparados por un ScheduledScan. Soporta dos
// canales: webhook (Slack/Discord compatible) y email SMTP. Cada uno se
// configura por schedule. Failover: si falla un canal, lo loggeamos y
// seguimos con el otro.

import nodemailer from 'nodemailer';

const NOTIFY_ON = Object.freeze({
  ALWAYS: 'always',
  FAIL_ONLY: 'onFailOnly',
  WARNING_OR_FAIL: 'onWarningOrFail',
});

let cachedTransport = null;

/**
 * Decide si notificar dado el modo y el summary del scan.
 */
export function shouldNotify(notifyOn, summary) {
  if (notifyOn === NOTIFY_ON.ALWAYS) return true;
  const failed = (summary?.failed ?? 0) > 0;
  const warned = (summary?.warnings ?? 0) > 0;
  if (notifyOn === NOTIFY_ON.FAIL_ONLY) return failed;
  if (notifyOn === NOTIFY_ON.WARNING_OR_FAIL) return failed || warned;
  return false;
}

/**
 * Notifica un scan completado/fallido. Es safe-call: nunca lanza excepción,
 * solo loggea errores. Llamado desde scan.queue al cierre.
 */
export async function notifyScanComplete({ schedule, scan, summary, errorMessage }) {
  try {
    if (!shouldNotify(schedule.notifyOn, summary)) {
      return { skipped: true, reason: 'no cumple notifyOn' };
    }
    const payload = buildPayload({ schedule, scan, summary, errorMessage });
    const results = await Promise.allSettled([
      schedule.notifyWebhook ? sendWebhook(schedule.notifyWebhook, payload) : null,
      schedule.notifyEmail ? sendEmail(schedule.notifyEmail, payload) : null,
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[notifier] canal falló:', r.reason?.message ?? r.reason);
      }
    }
    return { ok: true };
  } catch (err) {
    console.error('[notifier] error inesperado:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Notifica una corrida de Flow disparada por un ScheduledFlow (v2). Reusa los
 * canales webhook/email. notifyOn de flows: always | onFailOnly. Safe-call.
 */
export async function notifyFlowRunComplete({ schedule, flow, run }) {
  try {
    const failed = run.status === 'failed' || run.status === 'error';
    if (schedule.notifyOn === 'onFailOnly' && !failed) {
      return { skipped: true, reason: 'no cumple notifyOn (solo fallos)' };
    }
    const payload = buildFlowPayload({ schedule, flow, run });
    const results = await Promise.allSettled([
      schedule.notifyWebhook ? sendWebhook(schedule.notifyWebhook, payload) : null,
      schedule.notifyEmail ? sendEmail(schedule.notifyEmail, payload) : null,
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[notifier] canal de flow falló:', r.reason?.message ?? r.reason);
      }
    }
    return { ok: true };
  } catch (err) {
    console.error('[notifier] error inesperado (flow):', err.message);
    return { ok: false, error: err.message };
  }
}

function buildFlowPayload({ schedule, flow, run }) {
  const baseUrl = process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL?.split(',')[0]?.trim() || '';
  const runUrl = baseUrl ? `${baseUrl}/flows/runs/${run.id}` : null;
  const s = run.summary ?? {};
  const passedAll = run.status === 'passed';
  const emoji = passedAll ? '✅' : run.status === 'error' ? '🔥' : '❌';
  const title = `${emoji} QA Forge Flow — ${schedule.name}`;
  const summaryLine = run.errorMessage
    ? `Flow ${run.status.toUpperCase()}: ${truncate(run.errorMessage, 200)}`
    : `${s.passed ?? 0}/${s.total ?? 0} pasos ok${s.failed ? ` · ${s.failed} fallaron` : ''}${
        s.consoleErrors ? ` · ${s.consoleErrors} errores consola` : ''
      }`;
  return {
    title,
    summaryLine,
    reportUrl: runUrl,
    schedule: { id: schedule.id, name: schedule.name, cron: schedule.cron, url: flow?.url ?? '' },
    scan: { id: run.id, url: flow?.url ?? '', status: run.status, completedAt: run.completedAt },
    summary: null, // los flows no tienen byCategory; el webhook usa summaryLine
    errorMessage: run.errorMessage ?? null,
  };
}

function buildPayload({ schedule, scan, summary, errorMessage }) {
  const baseUrl = process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL?.split(',')[0]?.trim() || '';
  const reportUrl = baseUrl ? `${baseUrl}/scan/${scan.id}/report` : null;
  const status = scan.status;
  const failed = summary?.failed ?? 0;
  const warned = summary?.warnings ?? 0;
  const passed = summary?.passed ?? 0;
  const total = summary?.total ?? 0;
  const emoji = status === 'completed' && failed === 0 ? '✅' : status === 'failed' ? '🔥' : '⚠️';
  const title = `${emoji} QA Forge — ${schedule.name}`;
  const summaryLine = errorMessage
    ? `Scan FAILED: ${truncate(errorMessage, 200)}`
    : `${total} tests · ${passed} pass · ${warned} warning · ${failed} fail`;
  return {
    title,
    summaryLine,
    reportUrl,
    schedule: { id: schedule.id, name: schedule.name, cron: schedule.cron, url: schedule.url },
    scan: { id: scan.id, url: scan.url, status: scan.status, completedAt: scan.completedAt },
    summary: summary ?? null,
    errorMessage: errorMessage ?? null,
  };
}

async function sendWebhook(webhookUrl, payload) {
  // Slack y Discord aceptan { text: ... } como mínimo común. Para Slack rico
  // usaríamos `blocks`, para Discord `embeds` — pero `text` cubre los dos.
  const lines = [
    `*${payload.title}*`,
    `URL: ${payload.scan.url}`,
    payload.summaryLine,
  ];
  if (payload.reportUrl) lines.push(`Reporte: ${payload.reportUrl}`);
  if (payload.summary?.byCategory) {
    const cats = Object.entries(payload.summary.byCategory)
      .map(([cat, score]) => `${cat}=${score}`)
      .join(' · ');
    if (cats) lines.push(`Scores: ${cats}`);
  }
  const text = lines.join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }), // `content` para Discord, `text` para Slack
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`webhook ${res.status}: ${truncate(body, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmail(toAddress, payload) {
  const transport = await getEmailTransport();
  if (!transport) {
    throw new Error(
      'SMTP no configurado — setear SMTP_HOST, SMTP_USER, SMTP_PASS y SMTP_FROM en .env',
    );
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = payload.title;
  const html = renderHtmlEmail(payload);
  const text = [payload.summaryLine, payload.reportUrl].filter(Boolean).join('\n\n');
  await transport.sendMail({ from, to: toAddress, subject, html, text });
}

async function getEmailTransport() {
  if (cachedTransport !== null) return cachedTransport;
  const host = process.env.SMTP_HOST;
  if (!host) {
    cachedTransport = false;
    return null;
  }
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
  return cachedTransport;
}

function renderHtmlEmail(p) {
  const safeUrl = escapeHtml(p.scan.url);
  const safeSummary = escapeHtml(p.summaryLine);
  const reportLink = p.reportUrl
    ? `<p><a href="${escapeHtml(p.reportUrl)}" style="color:#10b981">Ver reporte completo →</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#020617;color:#e2e8f0;padding:24px">
    <h2 style="color:#f1f5f9">${escapeHtml(p.title)}</h2>
    <p style="color:#94a3b8">URL: <code>${safeUrl}</code></p>
    <p>${safeSummary}</p>
    ${reportLink}
    <hr style="border-color:#1e293b;margin:24px 0"/>
    <p style="color:#64748b;font-size:12px">QA Forge · schedule: ${escapeHtml(p.schedule.name)} (cron: <code>${escapeHtml(p.schedule.cron)}</code>)</p>
  </body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
