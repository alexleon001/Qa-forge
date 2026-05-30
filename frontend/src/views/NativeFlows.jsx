// NativeFlows — lista de flujos de testing sobre apps nativas (#15). Cada flujo
// corre en un device vía Appium (provider local o cloud). Determinista, igual que
// los flujos web pero con acciones native (tap/swipe/type + asserts).

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { NATIVE_PLATFORMS } from '@shared/constants.js';
import { deleteNativeFlow, listNativeFlows, listNativeProviders, runNativeFlow } from '../lib/api.js';

const RUN_STATUS_STYLE = {
  pending: 'text-slate-400',
  running: 'text-amber-300',
  passed: 'text-emerald-300',
  failed: 'text-red-300',
  error: 'text-red-400',
  cancelled: 'text-slate-500',
};

export function NativeFlows() {
  const navigate = useNavigate();
  const [flows, setFlows] = useState([]);
  const [hasProviders, setHasProviders] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const reload = () => {
    setLoading(true);
    Promise.all([listNativeFlows(), listNativeProviders()])
      .then(([fl, prov]) => {
        setFlows(fl ?? []);
        setHasProviders((prov ?? []).length > 0);
      })
      .catch(() => setFlows([]))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const handleRun = async (id) => {
    setBusyId(id);
    try {
      const run = await runNativeFlow(id);
      navigate(`/native/runs/${run.id}`);
    } catch {
      setBusyId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Borrar este flujo native y sus corridas?')) return;
    await deleteNativeFlow(id).catch(() => {});
    reload();
  };

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">native app testing · #15</p>
          <h1 className="text-2xl font-bold text-slate-50">Flujos native</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Testing e2e sobre apps iOS/Android reales vía Appium. Definí pasos (tap, escribir,
            swipe) con verificaciones y corrélos en un device local o en la nube.{' '}
            <Link to="/settings/native" className="text-emerald-300 hover:underline">
              Configurá los endpoints Appium
            </Link>
            .
          </p>
        </div>
        {hasProviders ? (
          <Link
            to="/native/new"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
          >
            + Nuevo flujo
          </Link>
        ) : null}
      </header>

      {!hasProviders ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-6 text-sm text-amber-200">
          Primero configurá un provider Appium (local o cloud) en{' '}
          <Link to="/settings/native" className="underline">
            Settings → Native
          </Link>
          .
        </p>
      ) : loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : flows.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-500">
          Todavía no creaste ningún flujo native.{' '}
          <Link to="/native/new" className="text-emerald-300 hover:underline">
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
                <Link to={`/native/${f.id}`} className="text-sm font-medium text-slate-100 hover:text-emerald-300">
                  {NATIVE_PLATFORMS[f.platform]?.icon ?? '📱'} {f.name}
                </Link>
                <p className="truncate text-xs text-slate-500">
                  {f.deviceName} · {f.provider?.label ?? '—'} · {f.stepCount} paso{f.stepCount === 1 ? '' : 's'}
                  {f.lastRun ? (
                    <>
                      {' · '}
                      <span className={RUN_STATUS_STYLE[f.lastRun.status] ?? 'text-slate-400'}>{f.lastRun.status}</span>
                      {f.lastRun.summary ? ` (${f.lastRun.summary.passed}/${f.lastRun.summary.total})` : ''}
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
                  to={`/native/${f.id}`}
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
