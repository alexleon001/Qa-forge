// ZapSecurity — OWASP ZAP security scanning (#14). Config del daemon ZAP +
// lanzar scans (spider/baseline/full) + lista de scans previos. El scan corre
// async contra el daemon ZAP del usuario; el detalle vive en /security/:id.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ZAP_SCAN_MODES } from '@shared/constants.js';
import {
  createZapScan,
  deleteZapScan,
  getZapConfig,
  listZapScans,
  saveZapConfig,
  testZapConfig,
} from '../lib/api.js';

const MODES = Object.values(ZAP_SCAN_MODES);
const STATUS_STYLE = {
  pending: 'text-slate-400',
  running: 'text-amber-300',
  completed: 'text-emerald-300',
  failed: 'text-red-300',
  cancelled: 'text-slate-500',
};

export function ZapSecurity() {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [configured, setConfigured] = useState(false);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    Promise.all([getZapConfig(), listZapScans()])
      .then(([cfg, sc]) => {
        setConfig(cfg.config);
        setConfigured(cfg.configured);
        setScans(sc ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-slate-500">security scanning · owasp zap (#14)</p>
        <h1 className="text-2xl font-bold text-slate-50">ZAP security scan</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Scan de seguridad profundo con OWASP ZAP corriendo como daemon. Spider + análisis
          pasivo (seguro) o activo (envía ataques — <strong className="text-amber-300">solo sobre
          sitios propios/autorizados</strong>). Necesitás un ZAP corriendo:{' '}
          <code className="text-slate-300">docker run -p 8080:8080 zaproxy/zap-stable zap.sh -daemon -host 0.0.0.0 -port 8080</code>.
        </p>
      </header>

      <ZapConfigPanel config={config} configured={configured} onSaved={reload} />

      {configured ? <NewScanForm onCreated={(s) => navigate(`/security/${s.id}`)} /> : null}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-300">Scans ({scans.length})</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : scans.length === 0 ? (
          <p className="text-sm text-slate-500">Sin scans todavía.</p>
        ) : (
          <ul className="space-y-2">
            {scans.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-3">
                <div className="min-w-0">
                  <Link to={`/security/${s.id}`} className="truncate text-sm font-medium text-slate-100 hover:text-emerald-300">
                    {s.url}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {ZAP_SCAN_MODES[s.mode]?.label ?? s.mode} ·{' '}
                    <span className={STATUS_STYLE[s.status] ?? 'text-slate-400'}>{s.status}</span>
                    {s.summary?.byRisk ? ` · ${riskLine(s.summary.byRisk)}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link to={`/security/${s.id}`} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300">
                    Ver
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm('¿Borrar este scan?')) return;
                      await deleteZapScan(s.id).catch(() => {});
                      reload();
                    }}
                    className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function riskLine(byRisk) {
  return ['High', 'Medium', 'Low', 'Informational']
    .filter((r) => byRisk[r])
    .map((r) => `${r[0]}:${byRisk[r]}`)
    .join(' ') || 'sin alertas';
}

function ZapConfigPanel({ config, configured, onSaved }) {
  const [open, setOpen] = useState(!configured);
  const [apiUrl, setApiUrl] = useState(config?.apiUrl ?? 'http://localhost:8080');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (config?.apiUrl) setApiUrl(config.apiUrl);
  }, [config]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await saveZapConfig({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim() || undefined });
      setApiKey('');
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const doTest = async () => {
    setTest({ testing: true });
    try {
      const r = await testZapConfig(apiUrl.trim() ? { apiUrl: apiUrl.trim(), apiKey: apiKey.trim() || undefined } : undefined);
      setTest({ ok: true, message: `Conectado · ZAP ${r.version ?? ''}` });
    } catch (err) {
      setTest({ ok: false, message: err?.response?.data?.message ?? err?.message ?? 'Falló' });
    }
  };

  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-semibold text-slate-200">
          ⚙ Daemon ZAP {configured ? <span className="text-emerald-400">· configurado{config?.hasApiKey ? ' 🔑' : ''}</span> : <span className="text-amber-300">· sin configurar</span>}
        </span>
        <span className="text-slate-500">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-slate-400">
            API URL del daemon ZAP
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://localhost:8080"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </label>
          <label className="block text-xs text-slate-400">
            API Key (opcional · ZAP puede correr sin key con -config api.disablekey=true)
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.hasApiKey ? '(sin cambios)' : 'api key del daemon'}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </label>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          {test && !test.testing ? <p className={`text-xs ${test.ok ? 'text-emerald-300' : 'text-red-300'}`}>{test.ok ? '✓ ' : '✗ '}{test.message}</p> : null}
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
              {saving ? '…' : 'Guardar'}
            </button>
            <button type="button" onClick={doTest} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-500/60">
              {test?.testing ? 'Probando…' : 'Probar conexión'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NewScanForm({ onCreated }) {
  const [url, setUrl] = useState('https://');
  const [mode, setMode] = useState('baseline');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const scan = await createZapScan({ url: url.trim(), mode });
      onCreated(scan);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo iniciar');
      setSubmitting(false);
    }
  };

  const modeMeta = ZAP_SCAN_MODES[mode];

  return (
    <form onSubmit={submit} className="mt-6 rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
      <label className="block text-xs uppercase tracking-widest text-slate-500">URL a escanear</label>
      <input
        type="url"
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://tu-sitio.com"
        className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              mode === m.id ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {m.label} {m.intrusive ? '⚠' : ''}
          </button>
        ))}
      </div>
      {modeMeta?.intrusive ? (
        <p className="mt-2 text-xs text-amber-300/90">
          ⚠ El modo activo envía payloads de ataque. Usalo solo sobre sitios de tu propiedad o con autorización explícita.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {submitting ? 'Iniciando…' : 'Iniciar scan'}
      </button>
    </form>
  );
}
