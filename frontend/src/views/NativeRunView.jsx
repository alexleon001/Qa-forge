// NativeRunView — corrida en vivo de un flujo native (#15). Suscribe a la room
// `native:<runId>` por Socket.io y muestra cada paso pass/fail con screenshot del
// device en los fallos. Mismo patrón que FlowRunView (stepResults compartidos).

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { cancelNativeFlowRun, getNativeFlowRun } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

const TERMINAL = new Set(['passed', 'failed', 'error', 'cancelled']);
const RUN_STATUS_STYLE = {
  pending: 'text-slate-400',
  running: 'text-amber-300',
  passed: 'text-emerald-300',
  failed: 'text-red-300',
  error: 'text-red-400',
  cancelled: 'text-slate-500',
};
const STEP_ICON = { passed: '✓', failed: '✗', skipped: '–', running: '…', pending: '·' };
const STEP_STYLE = {
  passed: 'border-emerald-500/40 bg-emerald-500/5',
  failed: 'border-red-500/50 bg-red-500/10',
  skipped: 'border-slate-700 bg-slate-900/40 opacity-60',
  running: 'border-amber-500/40 bg-amber-500/5',
  pending: 'border-slate-800 bg-slate-900/40',
};

export function NativeRunView() {
  const { runId } = useParams();
  const [run, setRun] = useState(null);
  const [steps, setSteps] = useState([]);
  const [status, setStatus] = useState('pending');
  const [summary, setSummary] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getNativeFlowRun(runId)
      .then((r) => {
        if (cancelled) return;
        setRun(r);
        setStatus(r.status);
        setSteps(Array.isArray(r.stepResults) ? r.stepResults : []);
        setSummary(r.summary ?? null);
        if (r.errorMessage) setError(r.errorMessage);
      })
      .catch((err) => setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo cargar la corrida'));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!run || TERMINAL.has(run.status)) return undefined;
    const socket = getSocket();
    socket.emit('native:subscribe', runId);

    const onStep = (p) => {
      if (p.runId !== runId) return;
      setStatus('running');
      setSteps((prev) => {
        const next = prev.filter((s) => s.index !== p.step.index);
        next.push(p.step);
        next.sort((a, b) => a.index - b.index);
        return next;
      });
    };
    const onProgress = (p) => {
      if (p.runId !== runId) return;
      setStatus('running');
      setProgress(p);
    };
    const onCompleted = (p) => {
      if (p.runId !== runId) return;
      setStatus(p.status ?? 'passed');
      setSummary(p.summary ?? null);
      setProgress(null);
      getNativeFlowRun(runId)
        .then((r) => {
          setRun(r);
          setSteps(Array.isArray(r.stepResults) ? r.stepResults : []);
          setSummary(r.summary ?? null);
        })
        .catch(() => {});
    };
    const onFailed = (p) => {
      if (p.runId !== runId) return;
      setStatus('error');
      setError(p.errorMessage ?? 'La corrida falló');
    };

    socket.on('native:step', onStep);
    socket.on('native:progress', onProgress);
    socket.on('native:completed', onCompleted);
    socket.on('native:failed', onFailed);
    return () => {
      socket.emit('native:unsubscribe', runId);
      socket.off('native:step', onStep);
      socket.off('native:progress', onProgress);
      socket.off('native:completed', onCompleted);
      socket.off('native:failed', onFailed);
    };
  }, [run, runId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [steps.length]);

  const handleCancel = async () => {
    try {
      await cancelNativeFlowRun(runId);
      setStatus('cancelled');
    } catch {
      /* noop */
    }
  };

  const running = status === 'running' || status === 'pending';

  if (error && !run) {
    return <section className="mx-auto max-w-3xl px-6 py-10 text-sm text-red-300">{error}</section>;
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {run?.nativeFlow ? (
            <Link to={`/native/${run.nativeFlow.id}`} className="text-xs text-slate-500 hover:text-slate-300">
              ← {run.nativeFlow.name}
            </Link>
          ) : (
            <Link to="/native" className="text-xs text-slate-500 hover:text-slate-300">
              ← Flujos native
            </Link>
          )}
          <h1 className="truncate text-xl font-bold text-slate-50">Corrida native</h1>
          <p className="mt-1 text-xs text-slate-500">
            Estado: <span className={RUN_STATUS_STYLE[status] ?? 'text-slate-400'}>{status}</span>
            {summary
              ? ` · ${summary.passed}/${summary.total} ok${summary.failed ? ` · ${summary.failed} fallaron` : ''}${
                  summary.skipped ? ` · ${summary.skipped} omitidos` : ''
                }${summary.durationMs ? ` · ${(summary.durationMs / 1000).toFixed(1)}s` : ''}`
              : ''}
          </p>
          {progress?.message ? <p className="mt-1 text-xs text-amber-300/80">{progress.message}</p> : null}
        </div>
        {running ? (
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
          >
            Cancelar
          </button>
        ) : null}
      </header>

      {error ? (
        <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}

      <ol className="space-y-2">
        {steps.map((s) => (
          <StepCard key={s.index} step={s} />
        ))}
        {running && steps.length === 0 ? <li className="text-xs text-slate-500">Esperando primer paso…</li> : null}
      </ol>
      <div ref={endRef} />
    </section>
  );
}

function StepCard({ step }) {
  const [showShot, setShowShot] = useState(false);
  const style = STEP_STYLE[step.status] ?? STEP_STYLE.pending;
  const icon = STEP_ICON[step.status] ?? '·';
  const iconColor = step.status === 'passed' ? 'text-emerald-300' : step.status === 'failed' ? 'text-red-300' : 'text-slate-400';
  return (
    <li className={`rounded-lg border px-3 py-2 text-xs ${style}`}>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold ${iconColor}`}>{icon}</span>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{step.index + 1}</span>
        <span className="font-medium text-slate-100">{step.action}</span>
        {step.strategy ? <span className="text-[10px] text-slate-500">{step.strategy}</span> : null}
        {step.selector ? <code className="truncate text-slate-400">{step.selector}</code> : null}
        {step.value ? <span className="truncate text-slate-500">= "{step.value}"</span> : null}
        {step.durationMs != null ? <span className="ml-auto text-[10px] text-slate-600">{step.durationMs}ms</span> : null}
      </div>
      {step.description ? <p className="mt-1 text-slate-500">{step.description}</p> : null}
      {step.message ? (
        <p className={`mt-1 ${step.status === 'failed' ? 'text-red-300/90' : 'text-slate-400'}`}>{step.message}</p>
      ) : null}
      {step.screenshotB64 ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowShot((v) => !v)}
            className="text-[11px] text-slate-300 underline decoration-dotted hover:text-emerald-300"
          >
            {showShot ? 'ocultar screenshot' : '📷 ver screenshot del device'}
          </button>
          {showShot ? (
            <img
              src={`data:image/png;base64,${step.screenshotB64}`}
              alt="screenshot del device"
              className="mt-2 max-h-[32rem] w-auto rounded border border-slate-700 object-contain"
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
