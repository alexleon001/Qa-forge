// ManualRunner — runner de ejecución de casos de prueba manuales (FASE 9).
// Unifica 3 fuentes en desplegables verticales por categoría: el checklist
// genérico fijo, los casos generados por IA y los casos custom del usuario.
// Cada caso se marca pass/fail/blocked/skip y admite notas de ejecución; todo
// se persiste por scan vía /api/manual-cases/:scanId/run.

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteManualRunItem,
  getManualRun,
  saveManualRunItem,
} from '../lib/api.js';

const CATEGORY_LABEL = {
  functional: 'Funcional',
  security: 'Seguridad',
  performance: 'Performance',
  accessibility: 'Accesibilidad',
  seo: 'SEO',
};
const CATEGORY_ORDER = ['functional', 'security', 'performance', 'accessibility', 'seo'];

const PRIORITY_TONE = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/40',
  high: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  medium: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};

// Estados de ejecución y su presentación (orden = orden de los botones).
const STATUS_ORDER = ['pending', 'pass', 'fail', 'blocked', 'skipped'];
const STATUS_META = {
  pending: { label: 'Pendiente', icon: '○', active: 'border-slate-500 bg-slate-600 text-slate-50', dot: 'text-slate-500' },
  pass: { label: 'Pass', icon: '✓', active: 'border-emerald-500 bg-emerald-500 text-slate-950', dot: 'text-emerald-400' },
  fail: { label: 'Fail', icon: '✕', active: 'border-red-500 bg-red-500 text-slate-950', dot: 'text-red-400' },
  blocked: { label: 'Bloqueado', icon: '⊘', active: 'border-amber-500 bg-amber-500 text-slate-950', dot: 'text-amber-400' },
  skipped: { label: 'Skip', icon: '»', active: 'border-sky-500 bg-sky-500 text-slate-950', dot: 'text-sky-400' },
};
const SOURCE_META = {
  generic: { label: 'Genérico', cls: 'border-slate-600 bg-slate-700/40 text-slate-300' },
  ai: { label: 'IA', cls: 'border-violet-500/40 bg-violet-500/15 text-violet-300' },
  custom: { label: 'Custom', cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' },
};

const NOTES_DEBOUNCE_MS = 800;
const EMPTY_FORM = { title: '', category: 'functional', priority: 'medium', description: '' };

export function ManualRunner({ scanId, aiCases }) {
  const [catalog, setCatalog] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [openCategories, setOpenCategories] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  // Carga inicial del runner (catálogo genérico + items trackeados).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getManualRun(scanId)
      .then((data) => {
        if (cancelled) return;
        setCatalog(data.catalog ?? []);
        setItems(data.items ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message ?? err?.message ?? 'Error cargando el runner');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  // Mapa caseKey → item trackeado, para resolver estado/notas de cada caso.
  const runMap = useMemo(() => {
    const map = {};
    for (const it of items) map[it.caseKey] = it;
    return map;
  }, [items]);

  // Lista unificada de casos: genéricos + IA + custom, con shape homogéneo.
  const allCases = useMemo(() => {
    const generic = (catalog ?? []).map((c) => ({
      caseKey: c.key,
      source: 'generic',
      category: c.category || 'functional',
      priority: c.priority || 'medium',
      title: c.title,
      description: c.description,
    }));
    const ai = (aiCases ?? []).map((c, i) => ({
      caseKey: c.id || `ai-${i}`,
      source: 'ai',
      category: c.category || 'functional',
      priority: c.priority || 'medium',
      title: c.title,
      preconditions: c.preconditions,
      steps: c.steps,
      postconditions: c.postconditions,
      testData: c.testData,
      caseNotes: c.notes,
    }));
    const custom = (items ?? [])
      .filter((it) => it.source === 'custom')
      .map((it) => ({
        caseKey: it.caseKey,
        source: 'custom',
        category: it.payload?.category || 'functional',
        priority: it.payload?.priority || 'medium',
        title: it.payload?.title || '(sin título)',
        description: it.payload?.description,
      }));
    return [...generic, ...ai, ...custom];
  }, [catalog, aiCases, items]);

  const grouped = useMemo(() => {
    const out = {};
    for (const tc of allCases) {
      const cat = CATEGORY_ORDER.includes(tc.category) ? tc.category : 'functional';
      (out[cat] ??= []).push(tc);
    }
    return out;
  }, [allCases]);

  // Resumen global de progreso.
  const summary = useMemo(() => {
    const counts = { pending: 0, pass: 0, fail: 0, blocked: 0, skipped: 0 };
    for (const tc of allCases) {
      const status = runMap[tc.caseKey]?.status ?? 'pending';
      counts[status] = (counts[status] ?? 0) + 1;
    }
    const total = allCases.length;
    const executed = total - counts.pending;
    return { ...counts, total, executed, pct: total ? Math.round((executed / total) * 100) : 0 };
  }, [allCases, runMap]);

  const toggleCategory = (cat) => setOpenCategories((p) => ({ ...p, [cat]: p[cat] === false }));

  // ── Persistencia ──────────────────────────────────────────────────────────

  /** Upsert optimista de un item del runner (estado o notas). */
  async function patchRun(caseKey, source, patch) {
    setItems((prev) => applyLocal(prev, { caseKey, source, ...patch }));
    setSaveState('saving');
    try {
      const saved = await saveManualRunItem(scanId, { caseKey, source, ...patch });
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.caseKey === saved.caseKey);
        if (idx === -1) return [...prev, saved];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo guardar el cambio');
    }
  }

  /** Crea un caso custom a partir del formulario. */
  async function handleCreateCustom(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const saved = await saveManualRunItem(scanId, {
        source: 'custom',
        payload: {
          title: form.title.trim(),
          category: form.category,
          priority: form.priority,
          description: form.description.trim() || null,
        },
      });
      setItems((prev) => [...prev, saved]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      // Asegura que la categoría del caso nuevo quede expandida para verlo.
      setOpenCategories((p) => ({ ...p, [saved.payload?.category ?? 'functional']: true }));
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo crear el caso');
    } finally {
      setCreating(false);
    }
  }

  /** Borra un caso custom. */
  async function handleDeleteCustom(caseKey) {
    setItems((prev) => prev.filter((i) => i.caseKey !== caseKey));
    try {
      await deleteManualRunItem(scanId, caseKey);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo borrar el caso');
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  const exportRows = () =>
    allCases.map((tc) => {
      const run = runMap[tc.caseKey];
      return {
        caseKey: tc.caseKey,
        source: tc.source,
        category: tc.category,
        priority: tc.priority,
        title: tc.title,
        status: run?.status ?? 'pending',
        notes: run?.notes ?? '',
        executedAt: run?.executedAt ?? '',
      };
    });

  const handleExport = (format) => {
    const rows = exportRows();
    if (format === 'json') {
      downloadBlob(JSON.stringify(rows, null, 2), `qa-forge-runner-${scanId}.json`, 'application/json');
    } else if (format === 'csv') {
      downloadBlob(toCsv(rows), `qa-forge-runner-${scanId}.csv`, 'text/csv');
    } else {
      downloadBlob(toMarkdown(rows, summary), `qa-forge-runner-${scanId}.md`, 'text/markdown');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <section className="mt-8 rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
        <p className="text-sm text-slate-500">Cargando runner…</p>
      </section>
    );
  }

  return (
    <section className="mt-8" data-testid="manual-runner">
      <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">🧪 Runner de casos manuales</h2>
            <p className="mt-1 text-xs text-slate-500">
              Checklist genérico + casos IA + casos propios. Marcá pass/fail por caso para llevar el control de la corrida.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10"
              data-testid="add-custom-case-btn"
            >
              {showForm ? 'Cerrar' : '+ Agregar caso'}
            </button>
            {['md', 'csv', 'json'].map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => handleExport(fmt)}
                className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
              >
                Exportar {fmt.toUpperCase()}
              </button>
            ))}
          </div>
        </header>

        {/* Barra de progreso global */}
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">
              {summary.executed}/{summary.total} ejecutados ({summary.pct}%)
            </span>
            <span className="flex flex-wrap gap-3">
              <Tally status="pass" n={summary.pass} />
              <Tally status="fail" n={summary.fail} />
              <Tally status="blocked" n={summary.blocked} />
              <Tally status="skipped" n={summary.skipped} />
              <Tally status="pending" n={summary.pending} />
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${summary.pct}%` }}
            />
          </div>
        </div>

        {saveState === 'error' || error ? (
          <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error ?? 'No se pudo guardar.'}
          </p>
        ) : saveState === 'saving' ? (
          <p className="mt-3 text-xs text-slate-500">Guardando…</p>
        ) : saveState === 'saved' ? (
          <p className="mt-3 text-xs text-emerald-400">✓ Cambios guardados</p>
        ) : null}

        {/* Formulario de caso custom */}
        {showForm ? (
          <form
            onSubmit={handleCreateCustom}
            className="mt-4 space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4"
            data-testid="custom-case-form"
          >
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Título del caso (ej: Verificar descuento aplicado en el carrito)"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              maxLength={300}
              required
            />
            <div className="flex flex-wrap gap-3">
              <label className="flex-1 text-xs text-slate-500">
                Categoría
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1 text-xs text-slate-500">
                Prioridad
                <select
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  {['critical', 'high', 'medium', 'low'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Descripción / qué verificar (opcional)"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              maxLength={4000}
            />
            <button
              type="submit"
              disabled={creating || !form.title.trim()}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? 'Agregando…' : 'Agregar caso'}
            </button>
          </form>
        ) : null}
      </div>

      {/* Desplegables verticales por categoría */}
      <div className="mt-4 space-y-3">
        {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => {
          const cases = grouped[cat];
          const isOpen = openCategories[cat] !== false; // default abierto
          const catCounts = countByStatus(cases, runMap);
          return (
            <section
              key={cat}
              className="overflow-hidden rounded-xl border border-slate-800/70 bg-slate-900/40"
            >
              <button
                type="button"
                onClick={() => toggleCategory(cat)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-900/70"
                data-testid={`runner-category-${cat}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-slate-400">{isOpen ? '▾' : '▸'}</span>
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-200">
                    {CATEGORY_LABEL[cat] || cat}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {cases.length} caso{cases.length === 1 ? '' : 's'}
                  </span>
                </div>
                <span className="flex gap-2">
                  {catCounts.pass ? <Tally status="pass" n={catCounts.pass} /> : null}
                  {catCounts.fail ? <Tally status="fail" n={catCounts.fail} /> : null}
                  {catCounts.blocked ? <Tally status="blocked" n={catCounts.blocked} /> : null}
                  {catCounts.skipped ? <Tally status="skipped" n={catCounts.skipped} /> : null}
                  {catCounts.pending ? <Tally status="pending" n={catCounts.pending} /> : null}
                </span>
              </button>
              {isOpen ? (
                <ul className="divide-y divide-slate-800/60 border-t border-slate-800/70">
                  {cases.map((tc) => (
                    <RunnerRow
                      key={tc.caseKey}
                      testCase={tc}
                      run={runMap[tc.caseKey]}
                      onStatus={(status) => patchRun(tc.caseKey, tc.source, { status })}
                      onNotes={(notes) => patchRun(tc.caseKey, tc.source, { notes })}
                      onDelete={tc.source === 'custom' ? () => handleDeleteCustom(tc.caseKey) : null}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

/** Fila de un caso con control de estado, detalle expandible y notas. */
function RunnerRow({ testCase, run, onStatus, onNotes, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const status = run?.status ?? 'pending';
  const priorityClass = PRIORITY_TONE[testCase.priority] ?? PRIORITY_TONE.medium;
  const source = SOURCE_META[testCase.source] ?? SOURCE_META.generic;
  const statusDot = STATUS_META[status]?.dot ?? STATUS_META.pending.dot;
  const hasDetail =
    testCase.description || testCase.steps?.length || testCase.preconditions?.length;

  return (
    <li className="px-5 py-3" data-testid={`runner-row-${testCase.caseKey}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-base leading-none ${statusDot}`}>
              {STATUS_META[status]?.icon ?? '○'}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest ${source.cls}`}
            >
              {source.label}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-widest ${priorityClass}`}
            >
              {testCase.priority}
            </span>
          </div>
          <button
            type="button"
            onClick={() => hasDetail && setExpanded((v) => !v)}
            className={`mt-1 text-left text-sm text-slate-100 ${hasDetail ? 'hover:text-emerald-300' : 'cursor-default'}`}
          >
            {testCase.title}
            {hasDetail ? (
              <span className="ml-1 text-xs text-slate-500">{expanded ? '▲' : '▾'}</span>
            ) : null}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {STATUS_ORDER.map((s) => {
            const meta = STATUS_META[s];
            const isActive = status === s;
            return (
              <button
                key={s}
                type="button"
                title={meta.label}
                onClick={() => onStatus(s)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                  isActive
                    ? meta.active
                    : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                }`}
                data-testid={`status-${s}-${testCase.caseKey}`}
              >
                <span className="mr-0.5">{meta.icon}</span>
                {meta.label}
              </button>
            );
          })}
          {onDelete ? (
            <button
              type="button"
              title="Borrar caso"
              onClick={onDelete}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-500 hover:border-red-500/60 hover:text-red-300"
              data-testid={`delete-${testCase.caseKey}`}
            >
              🗑
            </button>
          ) : null}
        </div>
      </div>

      {expanded && hasDetail ? (
        <div className="mt-3 rounded-lg border border-slate-800/60 bg-slate-950/40 px-4 py-3">
          <CaseDetail testCase={testCase} />
        </div>
      ) : null}

      <RunnerNotes
        key={testCase.caseKey}
        initial={run?.notes ?? ''}
        onSave={onNotes}
      />
    </li>
  );
}

/** Detalle del caso según su origen. */
function CaseDetail({ testCase }) {
  if (testCase.source === 'ai') {
    return (
      <div className="space-y-3 text-sm">
        {testCase.preconditions?.length ? (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Precondiciones</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-300">
              {testCase.preconditions.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {testCase.steps?.length ? (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Pasos</p>
            <ol className="mt-1 space-y-1.5">
              {testCase.steps.map((s, i) => (
                <li
                  key={i}
                  className="rounded-md border border-slate-800/60 bg-slate-900/40 px-3 py-2 text-slate-200"
                >
                  <p>
                    <span className="mr-2 text-xs font-semibold text-emerald-400">{i + 1}.</span>
                    {s.action}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    <span className="font-semibold text-slate-500">Esperado:</span> {s.expected}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {testCase.postconditions?.length ? (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Postcondiciones</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-300">
              {testCase.postconditions.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {testCase.testData ? (
          <p className="text-xs text-slate-400">
            <span className="font-semibold text-slate-500">Datos de prueba: </span>
            {testCase.testData}
          </p>
        ) : null}
        {testCase.caseNotes ? (
          <p className="text-xs italic text-slate-500">Notas: {testCase.caseNotes}</p>
        ) : null}
      </div>
    );
  }
  return <p className="text-sm text-slate-300">{testCase.description}</p>;
}

/** Notas de ejecución por caso, con auto-save debounced. */
function RunnerNotes({ initial, onSave }) {
  const [open, setOpen] = useState(Boolean(initial));
  const [value, setValue] = useState(initial);
  const timerRef = useRef(null);
  const lastSavedRef = useRef(initial);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleChange = (e) => {
    const next = e.target.value;
    setValue(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (next !== lastSavedRef.current) {
        lastSavedRef.current = next;
        onSave(next);
      }
    }, NOTES_DEBOUNCE_MS);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-slate-500 hover:text-emerald-300"
      >
        + Nota de ejecución
      </button>
    );
  }
  return (
    <textarea
      rows={2}
      value={value}
      onChange={handleChange}
      placeholder="Nota de ejecución: qué pasó, evidencia, link al bug…"
      className="mt-2 w-full resize-y rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
    />
  );
}

/** Contador compacto con color por estado. */
function Tally({ status, n }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className={`${meta.dot} font-medium`}>
      {meta.icon} {n}
    </span>
  );
}

function countByStatus(cases, runMap) {
  const counts = { pending: 0, pass: 0, fail: 0, blocked: 0, skipped: 0 };
  for (const tc of cases) {
    const s = runMap[tc.caseKey]?.status ?? 'pending';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

/** Inserta o mergea un item del runner en el estado local (update optimista). */
function applyLocal(items, { caseKey, source, status, notes }) {
  const idx = items.findIndex((i) => i.caseKey === caseKey);
  const nowIso = new Date().toISOString();
  if (idx === -1) {
    return [
      ...items,
      {
        caseKey,
        source,
        status: status ?? 'pending',
        notes: notes ?? null,
        payload: null,
        executedAt: status && status !== 'pending' ? nowIso : null,
      },
    ];
  }
  const next = [...items];
  const cur = next[idx];
  next[idx] = {
    ...cur,
    ...(status !== undefined
      ? { status, executedAt: status !== 'pending' ? nowIso : null }
      : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
  return next;
}

// ─── Export helpers ───────────────────────────────────────────────────────

function toCsv(rows) {
  const header = ['caseKey', 'source', 'category', 'priority', 'title', 'status', 'executedAt', 'notes'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [r.caseKey, r.source, r.category, r.priority, r.title, r.status, r.executedAt, r.notes]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n');
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toMarkdown(rows, summary) {
  const lines = [
    '# Runner de casos manuales — QA Forge',
    '',
    `Progreso: ${summary.executed}/${summary.total} ejecutados (${summary.pct}%) · `
      + `✓ ${summary.pass} · ✕ ${summary.fail} · ⊘ ${summary.blocked} · » ${summary.skipped} · ○ ${summary.pending}`,
    '',
  ];
  for (const cat of CATEGORY_ORDER) {
    const catRows = rows.filter((r) => r.category === cat);
    if (!catRows.length) continue;
    lines.push(`## ${CATEGORY_LABEL[cat] || cat}`, '');
    for (const r of catRows) {
      const icon = STATUS_META[r.status]?.icon ?? '○';
      lines.push(`- [${icon} ${r.status}] **${r.title}** _(${r.source}, ${r.priority})_`);
      if (r.notes) lines.push(`  - Nota: ${r.notes}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
