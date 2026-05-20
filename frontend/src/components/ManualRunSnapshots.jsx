// ManualRunSnapshots — historial de corridas archivadas del runner manual
// (FASE 9). Cada snapshot congela el estado de todos los casos de una corrida;
// sirve para comparar rondas de regresión.

import { useState } from 'react';

const STATUS_ICON = { pass: '✓', fail: '✕', blocked: '⊘', skipped: '»', pending: '○' };
const STATUS_COLOR = {
  pass: 'text-emerald-400',
  fail: 'text-red-400',
  blocked: 'text-amber-400',
  skipped: 'text-sky-400',
  pending: 'text-slate-500',
};
const CATEGORY_LABEL = {
  functional: 'Funcional',
  security: 'Seguridad',
  performance: 'Performance',
  accessibility: 'Accesibilidad',
  seo: 'SEO',
};

export function ManualRunSnapshots({ snapshots, onDelete }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  if (!snapshots?.length) return null;

  return (
    <section
      className="mt-4 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-900/40"
      data-testid="run-snapshots"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-900/70"
      >
        <div className="flex items-center gap-3">
          <span className="text-slate-400">{open ? '▾' : '▸'}</span>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-300">
            Corridas anteriores
          </h3>
          <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
            {snapshots.length}
          </span>
        </div>
      </button>

      {open ? (
        <ul className="divide-y divide-slate-800/60 border-t border-slate-800/70">
          {snapshots.map((snap) => {
            const s = snap.summary ?? {};
            const isExpanded = expandedId === snap.id;
            return (
              <li key={snap.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : snap.id)}
                    className="text-left"
                  >
                    <p className="text-sm font-medium text-slate-100">
                      {snap.label}{' '}
                      <span className="text-xs text-slate-500">{isExpanded ? '▲' : '▾'}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(snap.createdAt).toLocaleString()} · {s.executed ?? 0}/{s.total ?? 0}{' '}
                      ejecutados
                    </p>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="flex gap-2 text-xs">
                      <SnapTally status="pass" n={s.pass} />
                      <SnapTally status="fail" n={s.fail} />
                      <SnapTally status="blocked" n={s.blocked} />
                      <SnapTally status="skipped" n={s.skipped} />
                      <SnapTally status="pending" n={s.pending} />
                    </span>
                    <button
                      type="button"
                      onClick={() => onDelete(snap.id)}
                      title="Borrar corrida archivada"
                      className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-500 hover:border-red-500/60 hover:text-red-300"
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <ul className="mt-3 space-y-1 rounded-lg border border-slate-800/60 bg-slate-950/40 p-3">
                    {(snap.items ?? []).map((it) => (
                      <li key={it.caseKey} className="flex items-baseline gap-2 text-xs">
                        <span className={STATUS_COLOR[it.status] ?? STATUS_COLOR.pending}>
                          {STATUS_ICON[it.status] ?? '○'}
                        </span>
                        <span className="text-slate-500">
                          [{CATEGORY_LABEL[it.category] ?? it.category}]
                        </span>
                        <span className="text-slate-200">{it.title}</span>
                        {it.notes ? (
                          <span className="text-slate-500">— {it.notes}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function SnapTally({ status, n }) {
  if (!n) return null;
  return (
    <span className={STATUS_COLOR[status] ?? STATUS_COLOR.pending}>
      {STATUS_ICON[status]} {n}
    </span>
  );
}
