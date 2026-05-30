// Cliente de la API REST de OWASP ZAP (Zed Attack Proxy) corriendo como daemon.
// Sin dependencias (fetch nativo + AbortController), igual que jira/appium clients.
// La API de ZAP es HTTP: GET {base}/JSON/{component}/{view|action}/{name}/?params&apikey=.
// Cubre lo necesario: version (test), spider, passive (records to scan), active scan
// y lectura de alertas. Los scans son largos → el runner pollea status.

const DEFAULT_TIMEOUT_MS = 20_000;

export class ZapError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ZapError';
    this.status = status;
    this.code = code;
  }
}

/** Normaliza la apiUrl: http(s) válida, sin trailing slash. */
export function normalizeApiUrl(raw) {
  let v = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!v) throw new ZapError(400, 'INVALID_URL', 'apiUrl de ZAP requerida');
  let parsed;
  try {
    parsed = new URL(v);
  } catch {
    throw new ZapError(400, 'INVALID_URL', 'apiUrl de ZAP inválida');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ZapError(400, 'INVALID_URL', 'apiUrl debe ser http(s)');
  }
  return v;
}

async function zapRequest(config, path, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const base = normalizeApiUrl(config.apiUrl);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  if (config.apiKey) qs.set('apikey', config.apiKey);
  const url = `${base}${path}?${qs.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new ZapError(504, 'ZAP_TIMEOUT', `ZAP no respondió a tiempo (${timeoutMs}ms)`);
    throw new ZapError(502, 'ZAP_UNREACHABLE', `No se pudo conectar a ZAP (${base}): ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.message || json?.detail || text || `HTTP ${res.status}`;
    // ZAP devuelve "bad_api_key" / "missing_parameter" en el body.
    throw new ZapError(res.status === 403 ? 401 : res.status, json?.code || 'ZAP_ERROR', truncate(msg, 400));
  }
  return json;
}

// ─── Conexión ────────────────────────────────────────────────────────────────

export async function getVersion(config) {
  const v = await zapRequest(config, '/JSON/core/view/version/', {}, 10_000);
  return v?.version ?? null;
}

// ─── Spider ──────────────────────────────────────────────────────────────────

export async function startSpider(config, url, maxChildren) {
  const v = await zapRequest(config, '/JSON/spider/action/scan/', { url, recurse: true, ...(maxChildren ? { maxChildren } : {}) });
  return v?.scan ?? null; // scanId (string)
}

export async function spiderStatus(config, scanId) {
  const v = await zapRequest(config, '/JSON/spider/view/status/', { scanId }, 10_000);
  return Number(v?.status ?? 0);
}

export async function spiderResults(config, scanId) {
  const v = await zapRequest(config, '/JSON/spider/view/results/', { scanId });
  return Array.isArray(v?.results) ? v.results : [];
}

// ─── Passive scan ────────────────────────────────────────────────────────────

export async function passiveRecordsToScan(config) {
  const v = await zapRequest(config, '/JSON/pscan/view/recordsToScan/', {}, 10_000);
  return Number(v?.recordsToScan ?? 0);
}

// ─── Active scan ─────────────────────────────────────────────────────────────

export async function startActiveScan(config, url) {
  const v = await zapRequest(config, '/JSON/ascan/action/scan/', { url, recurse: true, inScopeOnly: false });
  return v?.scan ?? null;
}

export async function activeScanStatus(config, scanId) {
  const v = await zapRequest(config, '/JSON/ascan/view/status/', { scanId }, 10_000);
  return Number(v?.status ?? 0);
}

// ─── Alertas ─────────────────────────────────────────────────────────────────

export async function getAlerts(config, baseurl, count = 1000) {
  const v = await zapRequest(config, '/JSON/core/view/alerts/', { baseurl, start: 0, count });
  const alerts = Array.isArray(v?.alerts) ? v.alerts : [];
  return alerts.map(normalizeAlert);
}

function normalizeAlert(a) {
  return {
    name: a.alert || a.name || 'Alerta',
    risk: a.risk || 'Informational',
    confidence: a.confidence || '',
    url: a.url || '',
    param: a.param || '',
    description: truncate(a.description || '', 1_000),
    solution: truncate(a.solution || '', 1_000),
    reference: truncate(a.reference || '', 500),
    cweid: a.cweid || '',
    wascid: a.wascid || '',
  };
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
