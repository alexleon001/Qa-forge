// Flows — Flow Runner determinista. Lista los flujos e2e del usuario y permite
// crear uno nuevo. Cada flujo es una secuencia repetible de pasos con asserts que
// se ejecuta en un browser real (pass/fail por paso). A diferencia de Explore
// (agente IA no determinista), acá vos definís los pasos exactos.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { deleteFlow, listFlows, runFlow } from '../lib/api.js';

const RUN_STATUS_STYLE = {
  pending: 'text-slate-400',
  running: 'text-amber-300',
  passed: 'text-emerald-300',
  failed: 'text-red-300',
  error: 'text-red-400',
  cancelled: 'text-slate-500',
};

export function Flows() {
  const navigate = useNavigate();
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const reload = () => {
    setLoading(true);
    listFlows()
      .then((data) => setFlows(data.flows ?? []))
      .catch(() => setFlows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const handleRun = async (id) => {
    setBusyId(id);
    try {
      const run = await runFlow(id);
      navigate(`/flows/runs/${run.id}`);
    } catch {
      setBusyId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Borrar este flujo y sus corridas?')) return;
    try {
      await deleteFlow(id);
      reload();
    } catch {
      /* noop */
    }
  };

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">flow runner · e2e determinista</p>
          <h1 className="text-2xl font-bold text-slate-50">Flujos e2e</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Definí una secuencia de pasos (click, escribir, navegar) con verificaciones, y
            ejecutala en un navegador real. Repetible y determinista: ideal para regresión y
            smoke tests. Cada corrida te da pass/fail paso a paso con screenshot del fallo.
          </p>
        </div>
        <Link
          to="/flows/new"
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
          data-testid="flow-new-btn"
        >
          + Nuevo flujo
        </Link>
      </header>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : flows.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-500">
          Todavía no creaste ningún flujo.{' '}
          <Link to="/flows/new" className="text-emerald-300 hover:underline">
            Creá el primero
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-2">
          {flows.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-3"
            >
              <div className="min-w-0">
                <Link to={`/flows/${f.id}`} className="text-sm font-medium text-slate-100 hover:text-emerald-300">
                  {f.name}
                </Link>
                <p className="truncate text-xs text-slate-500">
                  {f.url} · {f.stepCount} paso{f.stepCount === 1 ? '' : 's'}
                  {f.lastRun ? (
                    <>
                      {' · última: '}
                      <span className={RUN_STATUS_STYLE[f.lastRun.status] ?? 'text-slate-400'}>{f.lastRun.status}</span>
                      {f.lastRun.summary
                        ? ` (${f.lastRun.summary.passed}/${f.lastRun.summary.total})`
                        : ''}
                    </>
                  ) : (
                    ' · sin corridas'
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === f.id}
                  onClick={() => handleRun(f.id)}
                  className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                >
                  {busyId === f.id ? '…' : '▶ Correr'}
                </button>
                <Link
                  to={`/flows/${f.id}`}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                >
                  Abrir
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(f.id)}
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
  );
}
