// ZapScanDetail — detalle en vivo de un scan OWASP ZAP (#14). Suscribe a la room
// `zap:<scanId>` y muestra el progreso por fase (spider/passive/active) + las
// alertas encontradas, agrupadas por riesgo con descripción y solución.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ZAP_RISK_LEVELS } from '@shared/constants.js';
import { cancelZapScan, getZapScan } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const STATUS_STYLE = {
  pending: 'text-slate-400',
  running: 'text-amber-300',
  completed: 'text-emerald-300',
  failed: 'text-red-300',
  cancelled: 'text-slate-500',
};
const RISK_STYLE = {
  High: 'border-red-500/50 bg-red-500/10 text-red-200',
  Medium: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
  Low: 'border-amber-500/40 bg-amber-500/5 text-amber-200',
  Informational: 'border-sky-500/40 bg-sky-500/5 text-sky-200',
};
const RISK_BADGE = {
  High: 'bg-red-500/20 text-red-300',
  Medium: 'bg-orange-500/20 text-orange-300',
  Low: 'bg-amber-500/20 text-amber-300',
  Informational: 'bg-sky-500/20 text-sky-300',
};

export function ZapScanDetail() {
  const { id } = useParams();
  const [scan, setScan] = useState(null);
  const [status, setStatus] = useState('pending');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getZapScan(id)
      .then((s) => {
        if (cancelled) return;
        setScan(s);
        setStatus(s.status);
        if (s.errorMessage) setError(s.errorMessage);
      })
      .catch((err) => setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo cargar el scan'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!scan || TERMINAL.has(scan.status)) return undefined;
    const socket = getSocket();
    socket.emit('zap:subscribe', id);
    const onProgress = (p) => {
      if (p.scanId !== id) return;
      setStatus('running');
      setProgress(p);
    };
    const onCompleted = (p) => {
      if (p.scanId !== id) return;
      setStatus(p.status ?? 'completed');
      setProgress(null);
      getZapScan(id).then(setScan).catch(() => {});
    };
    const onFailed = (p) => {
      if (p.scanId !== id) return;
      setStatus('failed');
      setError(p.errorMessage ?? 'El scan falló');
    };
    socket.on('zap:progress', onProgress);
    socket.on('zap:completed', onCompleted);
    socket.on('zap:failed', onFailed);
    return () => {
      socket.emit('zap:unsubscribe', id);
      socket.off('zap:progress', onProgress);
      socket.off('zap:completed', onCompleted);
      socket.off('zap:failed', onFailed);
    };
  }, [scan, id]);

  const alerts = Array.isArray(scan?.alerts) ? scan.alerts : [];
  const grouped = useMemo(() => {
    const g = {};
    for (const r of ZAP_RISK_LEVELS) g[r] = [];
    for (const a of alerts) (g[a.risk] ?? (g[a.risk] = [])).push(a);
    return g;
  }, [alerts]);

  const running = status === 'running' || status === 'pending';

  const handleCancel = async () => {
    try {
      await cancelZapScan(id);
      setStatus('cancelled');
    } catch {
      /* noop */
    }
  };

  if (error && !scan) {
    return <section className="mx-auto max-w-3xl px-6 py-10 text-sm text-red-300">{error}</section>;
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/security" className="text-xs text-slate-500 hover:text-slate-300">← ZAP security</Link>
          <h1 className="truncate text-xl font-bold text-slate-50">{scan?.url}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {scan?.mode} · Estado: <span className={STATUS_STYLE[status] ?? 'text-slate-400'}>{status}</span>
            {scan?.summary ? ` · ${scan.summary.total} alertas · ${scan.summary.urlsFound ?? 0} URLs` : ''}
          </p>
          {progress?.message ? <p className="mt-1 text-xs text-amber-300/80">{progress.message}</p> : null}
        </div>
        {running ? (
          <button type="button" onClick={handleCancel} className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10">
            Cancelar
          </button>
        ) : null}
      </header>

      {running ? <ProgressBars scan={scan} progress={progress} /> : null}

      {error ? <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      {scan?.summary?.byRisk ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {ZAP_RISK_LEVELS.map((r) => (
            <span key={r} className={`rounded-md px-3 py-1 text-xs font-medium ${RISK_BADGE[r]}`}>
              {r}: {scan.summary.byRisk[r] ?? 0}
            </span>
          ))}
        </div>
      ) : null}

      {!running && alerts.length === 0 && status === 'completed' ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-6 text-sm text-emerald-200">
          ✓ ZAP no reportó alertas para esta URL.
        </p>
      ) : null}

      {ZAP_RISK_LEVELS.map((risk) =>
        grouped[risk]?.length ? (
          <section key={risk} className="mb-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-slate-300">
              {risk} ({grouped[risk].length})
            </h2>
            <ul className="space-y-2">
              {grouped[risk].map((a, i) => (
                <AlertCard key={`${risk}-${i}`} alert={a} />
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </section>
  );
}

function ProgressBars({ scan, progress }) {
  const spider = progress?.spiderProgress ?? scan?.spiderProgress ?? 0;
  const active = progress?.activeProgress ?? scan?.activeProgress ?? 0;
  const phase = progress?.phase ?? scan?.phase;
  return (
    <div className="mb-5 space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <Bar label={`Spider${phase === 'spider' ? ' (en curso)' : ''}`} pct={spider} />
      {phase === 'passive' ? <p className="text-xs text-amber-300/80">Passive scan en curso…</p> : null}
      {scan?.mode === 'full' ? <Bar label={`Active scan${phase === 'active' ? ' (en curso)' : ''}`} pct={active} /> : null}
    </div>
  );
}

function Bar({ label, pct }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-slate-400">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AlertCard({ alert }) {
  const [open, setOpen] = useState(false);
  const style = RISK_STYLE[alert.risk] ?? RISK_STYLE.Informational;
  return (
    <li className={`rounded-md border px-3 py-2 text-xs ${style}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="font-medium text-slate-100">{alert.name}</span>
        <span className="shrink-0 text-[10px] opacity-70">
          {alert.confidence ? `conf: ${alert.confidence}` : ''} {open ? '−' : '+'}
        </span>
      </button>
      {alert.url ? <p className="mt-1 truncate text-[10px] text-slate-400">{alert.url}{alert.param ? ` · param: ${alert.param}` : ''}</p> : null}
      {open ? (
        <div className="mt-2 space-y-2 text-slate-300/90">
          {alert.description ? <p>{alert.description}</p> : null}
          {alert.solution ? (
            <p>
              <span className="font-semibold text-slate-200">Solución: </span>
              {alert.solution}
            </p>
          ) : null}
          {alert.cweid ? <p className="text-[10px] opacity-70">CWE-{alert.cweid}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
