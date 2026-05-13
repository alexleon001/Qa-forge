// Dashboard — muestra progreso y results en tiempo real para un scanId.

import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ScanProgress } from '../components/ScanProgress.jsx';
import { TestCard } from '../components/TestCard.jsx';
import { getScan } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { useScanStore } from '../store/scan.store.js';

const SOCKET_EVENT = {
  PROGRESS: 'scan:progress',
  RESULT: 'scan:result',
  COMPLETED: 'scan:completed',
  FAILED: 'scan:failed',
  SUBSCRIBE: 'scan:subscribe',
  UNSUBSCRIBE: 'scan:unsubscribe',
};

export function Dashboard() {
  const { scanId } = useParams();
  const {
    scanId: storedId,
    url,
    status,
    stage,
    message,
    errorMessage,
    results,
    summary,
    startScan,
    applyProgress,
    appendResult,
    markCompleted,
    markFailed,
  } = useScanStore();

  // Si el usuario entra directo al link, hidratamos el store desde el backend.
  useEffect(() => {
    if (storedId === scanId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getScan(scanId);
        if (cancelled) return;
        startScan({ scanId: data.id, url: data.url, status: data.status });
        for (const result of data.results) {
          appendResult({
            id: result.id,
            category: result.category,
            testName: result.testName,
            status: result.status,
            score: result.score,
            details: result.details,
          });
        }
        if (data.status === 'completed') markCompleted(null);
        if (data.status === 'failed') markFailed(data.errorMessage ?? 'Scan falló');
      } catch (err) {
        if (!cancelled) markFailed(err?.message ?? 'No se pudo cargar el scan');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanId, storedId, startScan, appendResult, markCompleted, markFailed]);

  // Suscripción Socket.io al room del scan.
  useEffect(() => {
    if (!scanId) return undefined;
    const socket = getSocket();
    socket.emit(SOCKET_EVENT.SUBSCRIBE, scanId);

    const onProgress = (payload) =>
      payload.scanId === scanId && applyProgress(payload);
    const onResult = (payload) =>
      payload.scanId === scanId && appendResult(payload.result);
    const onCompleted = (payload) =>
      payload.scanId === scanId && markCompleted(payload.summary);
    const onFailed = (payload) =>
      payload.scanId === scanId && markFailed(payload.errorMessage);

    socket.on(SOCKET_EVENT.PROGRESS, onProgress);
    socket.on(SOCKET_EVENT.RESULT, onResult);
    socket.on(SOCKET_EVENT.COMPLETED, onCompleted);
    socket.on(SOCKET_EVENT.FAILED, onFailed);

    return () => {
      socket.emit(SOCKET_EVENT.UNSUBSCRIBE, scanId);
      socket.off(SOCKET_EVENT.PROGRESS, onProgress);
      socket.off(SOCKET_EVENT.RESULT, onResult);
      socket.off(SOCKET_EVENT.COMPLETED, onCompleted);
      socket.off(SOCKET_EVENT.FAILED, onFailed);
    };
  }, [scanId, applyProgress, appendResult, markCompleted, markFailed]);

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">scan</p>
          <h1 className="text-2xl font-bold text-slate-50 break-all">{url ?? scanId}</h1>
          <p className="mt-1 text-sm text-slate-500">ID: {scanId}</p>
        </div>
        <StatusBadge status={status} />
      </header>

      <ScanProgress status={status} stage={stage} message={message} errorMessage={errorMessage} />

      {summary ? (
        <div
          className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
          data-testid="dashboard-summary"
        >
          <SummaryTile label="Total" value={summary.total} tone="info" />
          <SummaryTile label="Pass" value={summary.passed} tone="pass" />
          <SummaryTile label="Fail" value={summary.failed} tone="fail" />
          <SummaryTile label="Warning" value={summary.warnings} tone="warning" />
        </div>
      ) : null}

      {status === 'completed' ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to={`/scan/${scanId}/report`}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
            data-testid="goto-report-btn"
          >
            Ver reporte detallado →
          </Link>
          <Link
            to={`/scan/${scanId}/scripts`}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/10"
            data-testid="goto-scripts-btn"
          >
            Generar scripts E2E →
          </Link>
          <Link
            to={`/scan/${scanId}/manual-cases`}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/10"
            data-testid="goto-manual-cases-btn"
          >
            Casos manuales →
          </Link>
        </div>
      ) : null}

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
          Resultados ({results.length})
        </h2>
        {results.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-500">
            Esperando los primeros resultados…
          </p>
        ) : (
          <ul className="space-y-3">
            {results.map((result) => (
              <TestCard key={result.id ?? `${result.testName}-${result.category}`} result={result} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatusBadge({ status }) {
  const tones = {
    idle: 'bg-slate-700 text-slate-200',
    pending: 'bg-slate-700 text-slate-200',
    running: 'bg-blue-500/20 text-blue-300 border border-blue-500/40',
    completed: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40',
    failed: 'bg-red-500/15 text-red-300 border border-red-500/40',
  };
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-widest ${tones[status] ?? tones.idle}`}
      data-testid="dashboard-status"
    >
      {status}
    </span>
  );
}

function SummaryTile({ label, value, tone }) {
  const colors = {
    info: 'text-blue-300',
    pass: 'text-emerald-300',
    fail: 'text-red-300',
    warning: 'text-amber-300',
  };
  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-900/60 px-4 py-3">
      <div className="text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${colors[tone]}`}>{value}</div>
    </div>
  );
}
