// Dashboard — muestra progreso y results en tiempo real para un scanId.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { NotesEditor } from '../components/NotesEditor.jsx';
import { ScanProgress } from '../components/ScanProgress.jsx';
import { ScanTimer } from '../components/ScanTimer.jsx';
import { TestCard } from '../components/TestCard.jsx';
import { cancelScan, getScan } from '../lib/api.js';
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
    startedAt,
    completedAt,
    startScan,
    applyProgress,
    appendResult,
    markCompleted,
    markFailed,
  } = useScanStore();

  const [initialNotes, setInitialNotes] = useState('');
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState(null);
  const [crawlInfo, setCrawlInfo] = useState(null); // { mode, maxPages, children: [{id,url,status}] }
  const [loginInfo, setLoginInfo] = useState(null); // { url, hasPassword }

  // Si el usuario entra directo al link, hidratamos el store desde el backend.
  useEffect(() => {
    if (storedId === scanId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getScan(scanId);
        if (cancelled) return;
        setInitialNotes(data.notes ?? '');
        if (data.mode === 'crawl') {
          setCrawlInfo({
            mode: data.mode,
            maxPages: data.maxPages,
            children: data.children ?? [],
          });
        }
        if (data.loginConfig) {
          setLoginInfo({ url: data.loginConfig.url, hasPassword: data.loginConfig.hasPassword });
        }
        startScan({
          scanId: data.id,
          url: data.url,
          status: data.status,
          stage: data.stage,
          message: stageToMessage(data.stage),
          errorMessage: data.errorMessage,
          startedAt: data.startedAt,
          completedAt: data.completedAt,
        });
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

  const handleStop = async () => {
    if (!confirm('¿Cancelar el scan en curso? Los resultados parciales se conservan.')) return;
    setStopping(true);
    setStopError(null);
    try {
      await cancelScan(scanId);
    } catch (err) {
      setStopError(err?.response?.data?.message ?? err?.message ?? 'No se pudo cancelar');
    } finally {
      setStopping(false);
    }
  };

  const canStop = status === 'running' || status === 'pending';

  // Poll para refrescar el progreso de los child scans en modo crawl.
  // Los childs emiten a sus propios rooms, no al del parent — el parent solo
  // se entera cuando termina, así que polleamos /api/scan/:id que ya trae children.
  useEffect(() => {
    if (!crawlInfo || (status !== 'running' && status !== 'pending')) return undefined;
    const id = setInterval(async () => {
      try {
        const data = await getScan(scanId);
        setCrawlInfo({
          mode: data.mode,
          maxPages: data.maxPages,
          children: data.children ?? [],
        });
      } catch {}
    }, 3000);
    return () => clearInterval(id);
  }, [crawlInfo, scanId, status]);

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
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>ID: {scanId}</span>
            <DeviceBadge results={results} />
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={status} />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="uppercase tracking-widest">tiempo</span>
            <ScanTimer startedAt={startedAt} endedAt={completedAt} status={status} />
          </div>
        </div>
      </header>

      {loginInfo ? (
        <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5 text-xs text-emerald-300">
          <span aria-hidden>🔐</span>
          Login pre-flight activo →{' '}
          <span className="text-emerald-200/80">{loginInfo.url}</span>
        </div>
      ) : null}

      {crawlInfo ? (
        <CrawlPanel info={crawlInfo} parentStatus={status} />
      ) : null}

      <ScanProgress status={status} stage={stage} message={message} errorMessage={errorMessage} />

      {canStop ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping}
            className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="stop-scan-btn"
          >
            {stopping ? 'Cancelando…' : '■ Detener scan'}
          </button>
          {stopError ? <span className="text-xs text-red-300">{stopError}</span> : null}
        </div>
      ) : null}

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

      <NotesEditor scanId={scanId} initialNotes={initialNotes} />

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

function DeviceBadge({ results }) {
  const capture = results?.find((r) => r.testName === 'playwright.capture');
  const device = capture?.details?.device;
  if (!device?.label) return null;
  return (
    <span
      className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300"
      title={`Viewport: ${device.viewport?.width}×${device.viewport?.height}`}
    >
      {device.isMobile ? '📱' : '🖥️'} {device.label}
    </span>
  );
}

function stageToMessage(stage) {
  const map = {
    queued: 'Encolando scan',
    login_preflight: 'Autenticando con credenciales del usuario',
    discovering_urls: 'Descubriendo URLs para crawl',
    launching_browser: 'Lanzando browser',
    capturing_dom: 'Capturando DOM',
    analyzing_headers: 'Analizando HTTP headers',
    analyzing_ssl: 'Verificando certificado SSL',
    analyzing_seo: 'Analizando SEO',
    checking_links: 'Verificando links',
    analyzing_accessibility: 'Analizando accesibilidad (axe-core)',
    analyzing_performance: 'Consultando PageSpeed Insights',
    generating_scripts: 'Generando scripts',
    completed: 'Scan completado',
  };
  return map[stage] ?? null;
}

function CrawlPanel({ info, parentStatus }) {
  const { children = [], maxPages } = info;
  const done = children.filter((c) =>
    ['completed', 'failed', 'cancelled'].includes(c.status),
  ).length;
  const total = children.length;
  return (
    <div className="mb-3 rounded-lg border border-slate-800/70 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span aria-hidden>🕷️</span>
          Crawl multi-página
          <span className="text-xs font-normal text-slate-500">
            tope {maxPages} páginas
          </span>
        </h3>
        <span className="text-xs text-slate-400">
          {done}/{total || '…'} hijas terminadas
        </span>
      </div>
      {total === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          {parentStatus === 'running'
            ? 'Descubriendo URLs…'
            : 'Sin páginas hijas todavía.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {children.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded border border-slate-800/60 bg-slate-950/40 px-3 py-1.5 text-xs"
            >
              <Link
                to={`/scan/${c.id}`}
                className="flex-1 truncate text-slate-300 hover:text-emerald-300"
                title={c.url}
              >
                {c.url}
              </Link>
              <ChildStatusBadge status={c.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChildStatusBadge({ status }) {
  const tones = {
    pending: 'bg-slate-700 text-slate-300',
    running: 'bg-blue-500/20 text-blue-300',
    completed: 'bg-emerald-500/15 text-emerald-300',
    failed: 'bg-red-500/15 text-red-300',
    cancelled: 'bg-amber-500/15 text-amber-300',
  };
  return (
    <span
      className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest ${tones[status] ?? tones.pending}`}
    >
      {status}
    </span>
  );
}

function StatusBadge({ status }) {
  const tones = {
    idle: 'bg-slate-700 text-slate-200',
    pending: 'bg-slate-700 text-slate-200',
    running: 'bg-blue-500/20 text-blue-300 border border-blue-500/40',
    completed: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40',
    failed: 'bg-red-500/15 text-red-300 border border-red-500/40',
    cancelled: 'bg-amber-500/15 text-amber-300 border border-amber-500/40',
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
