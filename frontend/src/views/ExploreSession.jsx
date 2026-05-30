// ExploreSession — vista en vivo de una sesión de AI exploratory testing.
// Suscribe a la room `explore:<id>` por Socket.io y muestra el trail de pasos +
// los hallazgos a medida que llegan. Permite cancelar y mandar un hallazgo al
// repositorio de casos (FASE 10).

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  applyTestCaseActions,
  cancelExploration,
  createFlowFromExploration,
  getExploration,
  listSuts,
} from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

const SEVERITY_STYLE = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/40',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  low: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  info: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};
const VALID_CATEGORIES = ['functional', 'security', 'performance', 'accessibility', 'seo', 'ux'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function ExploreSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [steps, setSteps] = useState([]);
  const [findings, setFindings] = useState([]);
  const [status, setStatus] = useState('pending');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [converting, setConverting] = useState(false);
  const trailEndRef = useRef(null);

  // Carga inicial + (re)hidratación de una sesión ya terminada.
  useEffect(() => {
    let cancelled = false;
    getExploration(id)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setStatus(s.status);
        setSteps(Array.isArray(s.steps) ? s.steps : []);
        setFindings(Array.isArray(s.findings) ? s.findings : []);
      })
      .catch((err) => setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo cargar la sesión'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Suscripción a eventos en vivo (solo si todavía no terminó).
  useEffect(() => {
    if (!session || TERMINAL.has(session.status)) return undefined;
    const socket = getSocket();
    socket.emit('explore:subscribe', id);

    const onStep = (payload) => {
      if (payload.sessionId !== id) return;
      setSteps((prev) => [...prev, payload.step]);
    };
    const onFinding = (payload) => {
      if (payload.sessionId !== id) return;
      setFindings((prev) => (prev.some((f) => f.id === payload.finding.id) ? prev : [...prev, payload.finding]));
    };
    const onProgress = (payload) => {
      if (payload.sessionId !== id) return;
      setStatus('running');
      setProgress(payload);
    };
    const onCompleted = (payload) => {
      if (payload.sessionId !== id) return;
      setStatus('completed');
      setProgress(null);
      // Re-fetch para traer los hallazgos consolidados + summary persistido.
      getExploration(id).then((s) => {
        setSteps(Array.isArray(s.steps) ? s.steps : []);
        setFindings(Array.isArray(s.findings) ? s.findings : []);
        setSession(s);
      }).catch(() => {});
    };
    const onFailed = (payload) => {
      if (payload.sessionId !== id) return;
      setStatus('failed');
      setError(payload.errorMessage ?? 'La sesión falló');
    };

    socket.on('explore:step', onStep);
    socket.on('explore:finding', onFinding);
    socket.on('explore:progress', onProgress);
    socket.on('explore:completed', onCompleted);
    socket.on('explore:failed', onFailed);

    return () => {
      socket.emit('explore:unsubscribe', id);
      socket.off('explore:step', onStep);
      socket.off('explore:finding', onFinding);
      socket.off('explore:progress', onProgress);
      socket.off('explore:completed', onCompleted);
      socket.off('explore:failed', onFailed);
    };
  }, [session, id]);

  useEffect(() => {
    trailEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [steps.length]);

  const handleCancel = async () => {
    try {
      await cancelExploration(id);
      setStatus('cancelled');
    } catch {
      /* noop */
    }
  };

  const handleConvertToFlow = async () => {
    setConverting(true);
    try {
      const flow = await createFlowFromExploration(id);
      navigate(`/flows/${flow.id}`);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo convertir a flujo');
      setConverting(false);
    }
  };

  const running = status === 'running' || status === 'pending';
  const canConvert = !running && steps.some((s) => ['click', 'fill', 'navigate'].includes(s.action) && !s.blocked);

  if (error && !session) {
    return <section className="mx-auto max-w-4xl px-6 py-10 text-sm text-red-300">{error}</section>;
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/explore" className="text-xs text-slate-500 hover:text-slate-300">← Exploración</Link>
          <h1 className="truncate text-xl font-bold text-slate-50">{session?.url}</h1>
          {session?.goal ? <p className="mt-1 text-sm text-slate-400">🎯 {session.goal}</p> : null}
          <p className="mt-1 text-xs text-slate-500">
            Estado: <StatusBadge status={status} />
            {session ? ` · ${steps.length}/${session.maxSteps} pasos` : ''}
            {session?.provider ? ` · ${session.provider}${session.model ? ` (${session.model})` : ''}` : ''}
          </p>
          {progress?.message ? <p className="mt-1 text-xs text-amber-300/80">{progress.message}</p> : null}
        </div>
        <div className="flex gap-2">
          {canConvert ? (
            <button
              type="button"
              disabled={converting}
              onClick={handleConvertToFlow}
              title="Genera un flujo determinista borrador con los pasos del trail (selectores heurísticos, editables)"
              className="rounded-md border border-emerald-500/50 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
            >
              {converting ? '…' : '🎬 Convertir a flujo'}
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Trail de pasos */}
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-slate-300">Trail</h2>
          <ol className="space-y-2">
            {steps.map((s) => (
              <li key={s.n} className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{s.n}</span>
                  <span className="font-medium text-emerald-300">{s.action}</span>
                  {s.targetDesc ? <span className="truncate text-slate-400">{s.targetDesc}</span> : null}
                </div>
                {s.reasoning ? <p className="mt-1 text-slate-500">{s.reasoning}</p> : null}
                {s.blocked ? <p className="mt-1 text-amber-400/80">⚠ {s.blocked}</p> : null}
                <p className="mt-1 truncate text-[10px] text-slate-600">{s.url}</p>
              </li>
            ))}
            {running && steps.length === 0 ? <li className="text-xs text-slate-500">Esperando primer paso…</li> : null}
          </ol>
          <div ref={trailEndRef} />
        </div>

        {/* Hallazgos */}
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-slate-300">
            Hallazgos ({findings.length})
          </h2>
          {findings.length === 0 ? (
            <p className="text-xs text-slate-500">{running ? 'Buscando…' : 'Sin hallazgos.'}</p>
          ) : (
            <ul className="space-y-2">
              {findings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ status }) {
  const style =
    { running: 'text-amber-300', completed: 'text-emerald-300', failed: 'text-red-300', cancelled: 'text-slate-500' }[
      status
    ] ?? 'text-slate-400';
  return <span className={style}>{status}</span>;
}

function FindingCard({ finding }) {
  const [open, setOpen] = useState(false);
  const [suts, setSuts] = useState([]);
  const [sutId, setSutId] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);

  const sevStyle = SEVERITY_STYLE[finding.severity] ?? SEVERITY_STYLE.info;

  const openPicker = async () => {
    setOpen(true);
    if (suts.length === 0) {
      try {
        const list = await listSuts();
        setSuts(list);
        if (list[0]) setSutId(list[0].id);
      } catch {
        setErr('No se pudieron cargar los SUTs');
      }
    }
  };

  const sendToRepo = async () => {
    if (!sutId) return;
    setSending(true);
    setErr(null);
    try {
      const category = VALID_CATEGORIES.includes(finding.category) ? finding.category : 'functional';
      const priority = finding.severity === 'info' ? 'low' : finding.severity;
      await applyTestCaseActions(sutId, [
        {
          op: 'create',
          fields: {
            title: finding.title,
            description: finding.description,
            category,
            priority,
            status: 'draft',
            tags: ['exploratory'],
          },
        },
      ]);
      setSent(true);
      setOpen(false);
    } catch (e) {
      setErr(e?.response?.data?.message ?? e?.message ?? 'No se pudo crear el caso');
    } finally {
      setSending(false);
    }
  };

  return (
    <li className={`rounded-md border px-3 py-2 text-xs ${sevStyle}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide">{finding.severity}</span>
        <span className="text-[10px] opacity-70">{finding.category}</span>
      </div>
      <p className="mt-1 font-medium text-slate-100">{finding.title}</p>
      <p className="mt-1 text-slate-300/90">{finding.description}</p>
      {finding.evidence ? <p className="mt-1 text-[10px] opacity-60">evidencia: {finding.evidence}</p> : null}

      <div className="mt-2">
        {sent ? (
          <span className="text-[11px] text-emerald-300">✅ enviado al repositorio</span>
        ) : open ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sutId}
              onChange={(e) => setSutId(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100"
            >
              {suts.length === 0 ? <option value="">(sin SUTs — creá uno en Repositorio)</option> : null}
              {suts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!sutId || sending}
              onClick={sendToRepo}
              className="rounded bg-emerald-500 px-2 py-1 text-[11px] font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {sending ? '…' : 'Crear caso'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-slate-400 hover:text-slate-200">
              cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openPicker}
            className="text-[11px] text-slate-300 underline decoration-dotted hover:text-emerald-300"
          >
            📚 Mandar al repositorio
          </button>
        )}
        {err ? <p className="mt-1 text-[11px] text-red-300">{err}</p> : null}
      </div>
    </li>
  );
}
