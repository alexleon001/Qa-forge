// ManualRunner — runner de ejecución de casos de prueba manuales (FASE 9).
// Unifica 3 fuentes en desplegables verticales por categoría: el checklist
// genérico fijo, los casos generados por IA y los casos custom del usuario.
// Cada caso se marca pass/fail/blocked/skip y admite notas de ejecución.
// Además: sugerencias de pass/fail derivadas de los tests automáticos del
// scan, filtros/búsqueda, acciones masivas, bug en Jira desde un FAIL e
// historial de corridas (snapshots). Todo se persiste por scan.

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  bulkSaveManualRun,
  createJiraIssue,
  createManualRunSnapshot,
  deleteManualRunItem,
  deleteManualRunSnapshot,
  getJiraConfig,
  getManualRun,
  getManualRunSnapshots,
  getSut,
  importRepoCasesToRunner,
  listJiraIssues,
  listJiraProjects,
  listSuts,
  resetManualRun,
  saveManualRunItem,
} from '../lib/api.js';
import { ManualRunSnapshots } from './ManualRunSnapshots.jsx';

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
  repo: { label: 'Repo', cls: 'border-sky-500/40 bg-sky-500/15 text-sky-300' },
};

const NOTES_DEBOUNCE_MS = 800;
const EMPTY_FORM = {
  title: '',
  category: 'functional',
  priority: 'medium',
  description: '',
  preconditions: '',
  steps: [],
  postconditions: '',
};

const splitLines = (s) =>
  String(s ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function ManualRunner({ scanId, aiCases }) {
  const [catalog, setCatalog] = useState([]);
  const [items, setItems] = useState([]);
  const [suggestions, setSuggestions] = useState({});
  const [snapshots, setSnapshots] = useState([]);
  const [jira, setJira] = useState({ configured: false, projects: [], defaultProjectKey: '', defaultIssueType: 'Bug' });
  const [jiraIssues, setJiraIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [openCategories, setOpenCategories] = useState({});

  // Formulario de caso custom (alta y edición comparten el form).
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editKey, setEditKey] = useState(null); // caseKey si estamos editando
  const [editSource, setEditSource] = useState(null); // source del caso en edición
  const [creating, setCreating] = useState(false);

  // Filtros del runner.
  const [statusFilter, setStatusFilter] = useState(() => new Set());
  const [sourceFilter, setSourceFilter] = useState(() => new Set());
  const [query, setQuery] = useState('');

  // Cerrar corrida (snapshot).
  const [showClose, setShowClose] = useState(false);
  const [closeLabel, setCloseLabel] = useState('');
  const [closeReset, setCloseReset] = useState(true);
  const [closing, setClosing] = useState(false);

  // Importar casos del repositorio (FASE 10).
  const [showRepoImport, setShowRepoImport] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const formRef = useRef(null);

  // Carga inicial: runner + snapshots + (best-effort) Jira.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getManualRun(scanId),
      getManualRunSnapshots(scanId).catch(() => []),
    ])
      .then(([run, snaps]) => {
        if (cancelled) return;
        setCatalog(run.catalog ?? []);
        setItems(run.items ?? []);
        setSuggestions(run.suggestions ?? {});
        setSnapshots(snaps ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message ?? err?.message ?? 'Error cargando el runner');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Jira es opcional — si no está configurado, simplemente no mostramos el botón.
    getJiraConfig()
      .then((cfg) => {
        if (cancelled || !cfg?.configured) return;
        setJira((j) => ({
          ...j,
          configured: true,
          defaultProjectKey: cfg.config?.defaultProjectKey ?? '',
          defaultIssueType: cfg.config?.defaultIssueType ?? 'Bug',
        }));
        Promise.all([
          listJiraProjects().catch(() => []),
          listJiraIssues(scanId).catch(() => []),
        ]).then(([projects, issues]) => {
          if (cancelled) return;
          setJira((j) => ({ ...j, projects: projects ?? [] }));
          setJiraIssues(issues ?? []);
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [scanId]);

  // Al abrir el formulario (sobre todo al editar), traerlo a la vista.
  useEffect(() => {
    if (showForm) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showForm, editKey]);

  const runMap = useMemo(() => {
    const map = {};
    for (const it of items) map[it.caseKey] = it;
    return map;
  }, [items]);

  const jiraByCase = useMemo(() => {
    const map = {};
    for (const iss of jiraIssues) map[iss.resultId] = iss;
    return map;
  }, [jiraIssues]);

  // Lista unificada de casos (generic + ai + repo + custom). Para generic/ai el
  // `payload` del runner actúa como override editable del caso base; para
  // custom/repo el payload ES la definición. `payload.hidden` oculta el caso.
  const { allCases, hiddenCases } = useMemo(() => {
    const merge = (base, ov) => ({
      category: ov?.category ?? base.category ?? 'functional',
      priority: ov?.priority ?? base.priority ?? 'medium',
      title: ov?.title ?? base.title ?? '(sin título)',
      description: ov && 'description' in ov ? ov.description : base.description,
      preconditions: ov?.preconditions ?? base.preconditions,
      steps: ov?.steps ?? base.steps,
      postconditions: ov?.postconditions ?? base.postconditions,
      testData: ov?.testData ?? base.testData,
      caseNotes: base.caseNotes,
    });
    const generic = (catalog ?? []).map((c) => {
      const ov = runMap[c.key]?.payload;
      return {
        caseKey: c.key,
        source: 'generic',
        _hidden: ov?.hidden === true,
        ...merge(
          { category: c.category, priority: c.priority, title: c.title, description: c.description },
          ov,
        ),
      };
    });
    const ai = (aiCases ?? []).map((c, i) => {
      const caseKey = c.id || `ai-${i}`;
      const ov = runMap[caseKey]?.payload;
      return {
        caseKey,
        source: 'ai',
        _hidden: ov?.hidden === true,
        ...merge(
          {
            category: c.category,
            priority: c.priority,
            title: c.title,
            preconditions: c.preconditions,
            steps: c.steps,
            postconditions: c.postconditions,
            testData: c.testData,
            caseNotes: c.notes,
          },
          ov,
        ),
      };
    });
    const fromItems = (source) =>
      (items ?? [])
        .filter((it) => it.source === source)
        .map((it) => {
          const p = it.payload ?? {};
          return {
            caseKey: it.caseKey,
            source,
            _hidden: p.hidden === true,
            code: p.code,
            category: p.category || 'functional',
            priority: p.priority || 'medium',
            title: p.title || '(sin título)',
            description: p.description,
            preconditions: p.preconditions,
            steps: p.steps,
            postconditions: p.postconditions,
            testData: p.testData,
          };
        });
    const everything = [...generic, ...ai, ...fromItems('repo'), ...fromItems('custom')];
    return {
      allCases: everything.filter((c) => !c._hidden),
      hiddenCases: everything.filter((c) => c._hidden),
    };
  }, [catalog, aiCases, items, runMap]);

  const grouped = useMemo(() => {
    const out = {};
    for (const tc of allCases) {
      const cat = CATEGORY_ORDER.includes(tc.category) ? tc.category : 'functional';
      (out[cat] ??= []).push(tc);
    }
    return out;
  }, [allCases]);

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

  // Sugerencias aún sin aplicar (caso genérico, pendiente, con sugerencia).
  const pendingSuggestions = useMemo(
    () =>
      allCases.filter(
        (tc) =>
          tc.source === 'generic' &&
          suggestions[tc.caseKey] &&
          (runMap[tc.caseKey]?.status ?? 'pending') === 'pending',
      ),
    [allCases, suggestions, runMap],
  );

  const filterActive = statusFilter.size > 0 || sourceFilter.size > 0 || query.trim() !== '';

  function matchesFilter(tc, status) {
    if (statusFilter.size && !statusFilter.has(status)) return false;
    if (sourceFilter.size && !sourceFilter.has(tc.source)) return false;
    if (query.trim() && !tc.title.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  }

  const toggleCategory = (cat) => setOpenCategories((p) => ({ ...p, [cat]: p[cat] === false }));

  const toggleSet = (setter) => (value) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  const toggleStatusFilter = toggleSet(setStatusFilter);
  const toggleSourceFilter = toggleSet(setSourceFilter);

  const clearFilters = () => {
    setStatusFilter(new Set());
    setSourceFilter(new Set());
    setQuery('');
  };

  // ── Persistencia ──────────────────────────────────────────────────────────

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

  function cancelForm() {
    setShowForm(false);
    setEditKey(null);
    setEditSource(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmitCase(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      // En edición, partir del payload existente para conservar lo que el form
      // no toca (code del repo, testData, etc.); los campos del form lo pisan.
      const existing = editKey ? runMap[editKey]?.payload ?? {} : {};
      const payload = {
        ...existing,
        title: form.title.trim(),
        category: form.category,
        priority: form.priority,
        description: form.description.trim() || null,
        preconditions: splitLines(form.preconditions),
        steps: form.steps
          .map((s) => ({ action: s.action.trim(), expected: s.expected.trim() }))
          .filter((s) => s.action || s.expected),
        postconditions: splitLines(form.postconditions),
      };
      const body = editKey
        ? { caseKey: editKey, source: editSource ?? 'custom', payload }
        : { source: 'custom', payload };
      const saved = await saveManualRunItem(scanId, body);
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.caseKey === saved.caseKey);
        if (idx === -1) return [...prev, saved];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      setOpenCategories((p) => ({ ...p, [payload.category]: true }));
      cancelForm();
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo guardar el caso');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(tc) {
    setEditKey(tc.caseKey);
    setEditSource(tc.source);
    setForm({
      title: tc.title ?? '',
      category: tc.category ?? 'functional',
      priority: tc.priority ?? 'medium',
      description: tc.description ?? '',
      preconditions: (tc.preconditions ?? []).join('\n'),
      steps: (tc.steps ?? []).map((s) => ({ action: s.action ?? '', expected: s.expected ?? '' })),
      postconditions: (tc.postconditions ?? []).join('\n'),
    });
    setShowForm(true);
  }

  function startCreate() {
    if (showForm && !editKey) {
      cancelForm();
      return;
    }
    setEditKey(null);
    setEditSource(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  /** Oculta o restaura un caso generic/ai del runner (override payload.hidden). */
  async function setCaseHidden(tc, hidden) {
    const payload = { ...(runMap[tc.caseKey]?.payload ?? {}), hidden };
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.caseKey === tc.caseKey);
      if (idx === -1) {
        return [
          ...prev,
          {
            caseKey: tc.caseKey,
            source: tc.source,
            status: 'pending',
            notes: null,
            payload,
            executedAt: null,
          },
        ];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], payload };
      return next;
    });
    try {
      const saved = await saveManualRunItem(scanId, {
        caseKey: tc.caseKey,
        source: tc.source,
        payload,
      });
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.caseKey === saved.caseKey);
        if (idx === -1) return [...prev, saved];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo actualizar el caso');
    }
  }

  /** Borra (custom/repo) u oculta (generic/ai) un caso del runner. */
  async function handleDeleteCase(tc) {
    if (tc.source === 'custom' || tc.source === 'repo') {
      if (!window.confirm(`¿Quitar "${tc.title}" del runner?`)) return;
      setItems((prev) => prev.filter((i) => i.caseKey !== tc.caseKey));
      try {
        await deleteManualRunItem(scanId, tc.caseKey);
      } catch (err) {
        setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo borrar el caso');
      }
    } else {
      await setCaseHidden(tc, true);
    }
  }

  /** Aplica un upsert masivo y refresca el estado local con la respuesta. */
  async function applyBulk(updates) {
    if (!updates.length) return;
    setSaveState('saving');
    try {
      const fresh = await bulkSaveManualRun(scanId, updates);
      setItems(fresh);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo aplicar la acción masiva');
    }
  }

  const applyAllSuggestions = () =>
    applyBulk(
      pendingSuggestions.map((tc) => ({
        caseKey: tc.caseKey,
        source: 'generic',
        status: suggestions[tc.caseKey].status,
      })),
    );

  const bulkMarkCategory = (cat, status) =>
    applyBulk(
      grouped[cat]
        .filter((tc) => (runMap[tc.caseKey]?.status ?? 'pending') === 'pending')
        .map((tc) => ({ caseKey: tc.caseKey, source: tc.source, status })),
    );

  async function handleReset() {
    if (!window.confirm('¿Resetear la corrida? Todos los casos vuelven a "pendiente".')) return;
    try {
      await resetManualRun(scanId);
      setItems([]);
      setSaveState('saved');
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo resetear');
    }
  }

  async function handleCloseRun() {
    if (!closeLabel.trim()) return;
    setClosing(true);
    setError(null);
    try {
      const snapItems = allCases.map((tc) => ({
        caseKey: tc.caseKey,
        source: tc.source,
        title: tc.title,
        category: tc.category,
        priority: tc.priority,
        status: runMap[tc.caseKey]?.status ?? 'pending',
        notes: runMap[tc.caseKey]?.notes ?? null,
      }));
      const snap = await createManualRunSnapshot(scanId, {
        label: closeLabel.trim(),
        reset: closeReset,
        items: snapItems,
      });
      setSnapshots((prev) => [snap, ...prev]);
      if (closeReset) setItems([]);
      setShowClose(false);
      setCloseLabel('');
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo cerrar la corrida');
    } finally {
      setClosing(false);
    }
  }

  async function handleDeleteSnapshot(id) {
    if (!window.confirm('¿Borrar esta corrida archivada?')) return;
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
    try {
      await deleteManualRunSnapshot(scanId, id);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo borrar la corrida');
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = (format) => {
    const rows = allCases.map((tc) => {
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

  const visibleCategories = CATEGORY_ORDER.filter((cat) => {
    const cases = grouped[cat] ?? [];
    if (!cases.length) return false;
    return cases.some((tc) => matchesFilter(tc, runMap[tc.caseKey]?.status ?? 'pending'));
  });

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
              onClick={startCreate}
              className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10"
              data-testid="add-custom-case-btn"
            >
              {showForm ? 'Cerrar' : '+ Agregar caso'}
            </button>
            <button
              type="button"
              onClick={() => setShowRepoImport((v) => !v)}
              className="rounded-md border border-sky-500/40 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/10"
            >
              📚 {showRepoImport ? 'Cerrar' : 'Importar del repo'}
            </button>
            <button
              type="button"
              onClick={() => setShowClose((v) => !v)}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
            >
              Cerrar corrida
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-400 hover:border-red-500/60 hover:text-red-300"
            >
              Resetear
            </button>
            {['md', 'csv', 'json'].map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => handleExport(fmt)}
                className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
              >
                {fmt.toUpperCase()}
              </button>
            ))}
          </div>
        </header>

        {/* Progreso global */}
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
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${summary.pct}%` }} />
          </div>
        </div>

        {/* Sugerencias del scan automático */}
        {pendingSuggestions.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2">
            <span className="text-xs text-violet-200">
              💡 El scan automático ya responde {pendingSuggestions.length} caso
              {pendingSuggestions.length === 1 ? '' : 's'} del checklist.
            </span>
            <button
              type="button"
              onClick={applyAllSuggestions}
              className="rounded-md border border-violet-500/50 bg-violet-500/20 px-3 py-1 text-xs font-medium text-violet-100 hover:bg-violet-500/30"
              data-testid="apply-all-suggestions"
            >
              Aplicar {pendingSuggestions.length} sugerencia{pendingSuggestions.length === 1 ? '' : 's'}
            </button>
          </div>
        ) : null}

        {saveState === 'error' || error ? (
          <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error ?? 'No se pudo guardar.'}
          </p>
        ) : saveState === 'saving' ? (
          <p className="mt-3 text-xs text-slate-500">Guardando…</p>
        ) : saveState === 'saved' ? (
          <p className="mt-3 text-xs text-emerald-400">✓ Cambios guardados</p>
        ) : null}

        {/* Filtros */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar caso…"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            data-testid="runner-search"
          />
          <span className="flex flex-wrap gap-1">
            {STATUS_ORDER.map((s) => (
              <FilterChip
                key={s}
                active={statusFilter.has(s)}
                onClick={() => toggleStatusFilter(s)}
                tone={STATUS_META[s].dot}
              >
                {STATUS_META[s].icon} {STATUS_META[s].label}
              </FilterChip>
            ))}
          </span>
          <span className="flex flex-wrap gap-1">
            {Object.entries(SOURCE_META).map(([k, m]) => (
              <FilterChip key={k} active={sourceFilter.has(k)} onClick={() => toggleSourceFilter(k)}>
                {m.label}
              </FilterChip>
            ))}
          </span>
          {filterActive ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-slate-500 underline hover:text-slate-300"
            >
              limpiar
            </button>
          ) : null}
        </div>

        {/* Formulario de caso (alta de custom / edición de cualquier caso) */}
        {showForm ? (
          <form
            ref={formRef}
            onSubmit={handleSubmitCase}
            className="mt-4 space-y-3 rounded-lg border border-emerald-500/30 bg-slate-950/50 p-4"
            data-testid="custom-case-form"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-widest text-slate-500">
                {editKey
                  ? `Editar caso${editSource ? ` · ${SOURCE_META[editSource]?.label ?? editSource}` : ''}`
                  : 'Nuevo caso manual'}
              </p>
              <button
                type="button"
                onClick={cancelForm}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Cancelar
              </button>
            </div>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Título del caso"
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
            <div>
              <label className="text-xs uppercase tracking-widest text-slate-500">
                Precondiciones (una por línea)
              </label>
              <textarea
                rows={2}
                value={form.preconditions}
                onChange={(e) => setForm((f) => ({ ...f, preconditions: e.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-slate-500">Pasos</label>
              <div className="mt-1">
                <StepRowsEditor
                  steps={form.steps}
                  onChange={(steps) => setForm((f) => ({ ...f, steps }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-slate-500">
                Postcondiciones (una por línea)
              </label>
              <textarea
                rows={2}
                value={form.postconditions}
                onChange={(e) => setForm((f) => ({ ...f, postconditions: e.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating || !form.title.trim()}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? 'Guardando…' : editKey ? 'Guardar cambios' : 'Agregar caso'}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                disabled={creating}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-slate-100"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : null}

        {/* Cerrar corrida (snapshot) */}
        {showClose ? (
          <div className="mt-4 space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-xs uppercase tracking-widest text-slate-500">Cerrar corrida</p>
            <p className="text-xs text-slate-500">
              Archiva el estado actual de los {summary.total} casos como una corrida. Útil para
              comparar rondas de regresión.
            </p>
            <input
              type="text"
              value={closeLabel}
              onChange={(e) => setCloseLabel(e.target.value)}
              placeholder="Nombre de la corrida (ej: Regresión sprint 12)"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              maxLength={120}
            />
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={closeReset}
                onChange={(e) => setCloseReset(e.target.checked)}
              />
              Resetear el runner después de archivar (empezar otra ronda)
            </label>
            <button
              type="button"
              onClick={handleCloseRun}
              disabled={closing || !closeLabel.trim()}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {closing ? 'Archivando…' : 'Archivar corrida'}
            </button>
          </div>
        ) : null}

        {showRepoImport ? (
          <RepoImportPanel
            scanId={scanId}
            onImported={(freshItems) => {
              setItems(freshItems);
              setShowRepoImport(false);
            }}
          />
        ) : null}
      </div>

      {/* Desplegables verticales por categoría */}
      <div className="mt-4 space-y-3">
        {visibleCategories.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
            Ningún caso coincide con el filtro.
          </p>
        ) : null}
        {visibleCategories.map((cat) => {
          const cases = grouped[cat];
          const visible = cases.filter((tc) =>
            matchesFilter(tc, runMap[tc.caseKey]?.status ?? 'pending'),
          );
          const isOpen = openCategories[cat] !== false; // default abierto
          const catCounts = countByStatus(cases, runMap);
          const hasPending = catCounts.pending > 0;
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
                    {filterActive ? `${visible.length}/${cases.length}` : cases.length} caso
                    {cases.length === 1 ? '' : 's'}
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
                <div className="border-t border-slate-800/70">
                  {hasPending ? (
                    <div className="flex items-center gap-2 bg-slate-950/30 px-5 py-2 text-xs text-slate-500">
                      Marcar {catCounts.pending} pendiente{catCounts.pending === 1 ? '' : 's'}:
                      <button
                        type="button"
                        onClick={() => bulkMarkCategory(cat, 'pass')}
                        className="rounded border border-emerald-500/40 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/10"
                      >
                        ✓ Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => bulkMarkCategory(cat, 'skipped')}
                        className="rounded border border-sky-500/40 px-2 py-0.5 text-sky-300 hover:bg-sky-500/10"
                      >
                        » Skip
                      </button>
                    </div>
                  ) : null}
                  <ul className="divide-y divide-slate-800/60">
                    {visible.map((tc) => (
                      <RunnerRow
                        key={tc.caseKey}
                        testCase={tc}
                        run={runMap[tc.caseKey]}
                        suggestion={tc.source === 'generic' ? suggestions[tc.caseKey] : null}
                        jira={jira}
                        existingIssue={jiraByCase[tc.caseKey]}
                        onStatus={(status) => patchRun(tc.caseKey, tc.source, { status })}
                        onNotes={(notes) => patchRun(tc.caseKey, tc.source, { notes })}
                        onDelete={() => handleDeleteCase(tc)}
                        onEdit={() => startEdit(tc)}
                        onJiraCreated={(issue) => setJiraIssues((prev) => [issue, ...prev])}
                        scanId={scanId}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {hiddenCases.length > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-800/70 bg-slate-900/40 px-5 py-3">
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="flex w-full items-center gap-2 text-left text-xs text-slate-500 hover:text-slate-300"
          >
            <span>{showHidden ? '▾' : '▸'}</span>
            🚫 {hiddenCases.length} caso{hiddenCases.length === 1 ? '' : 's'} oculto
            {hiddenCases.length === 1 ? '' : 's'}
          </button>
          {showHidden ? (
            <ul className="mt-2 space-y-1">
              {hiddenCases.map((tc) => (
                <li key={tc.caseKey} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-slate-400 line-through">
                    {tc.code ? `${tc.code} ` : ''}
                    {tc.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCaseHidden(tc, false)}
                    className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-slate-400 hover:border-emerald-500/60 hover:text-emerald-300"
                  >
                    Restaurar
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ManualRunSnapshots snapshots={snapshots} onDelete={handleDeleteSnapshot} />
    </section>
  );
}

/** Fila de un caso con control de estado, sugerencia, detalle, notas y Jira. */
function RunnerRow({
  testCase,
  run,
  suggestion,
  jira,
  existingIssue,
  onStatus,
  onNotes,
  onDelete,
  onEdit,
  onJiraCreated,
  scanId,
}) {
  const [expanded, setExpanded] = useState(false);
  const status = run?.status ?? 'pending';
  const priorityClass = PRIORITY_TONE[testCase.priority] ?? PRIORITY_TONE.medium;
  const source = SOURCE_META[testCase.source] ?? SOURCE_META.generic;
  const statusDot = STATUS_META[status]?.dot ?? STATUS_META.pending.dot;
  const hasDetail =
    testCase.description || testCase.steps?.length || testCase.preconditions?.length;
  const showSuggestion = suggestion && status === 'pending';
  const canFileBug = jira?.configured && (status === 'fail' || status === 'blocked');

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
            {testCase.code ? (
              <span className="mr-1 font-mono text-xs text-slate-500">{testCase.code}</span>
            ) : null}
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
          {onEdit ? (
            <button
              type="button"
              title="Editar caso"
              onClick={onEdit}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-500 hover:border-emerald-500/60 hover:text-emerald-300"
            >
              ✎
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              title={
                testCase.source === 'generic' || testCase.source === 'ai'
                  ? 'Ocultar caso'
                  : 'Quitar caso'
              }
              onClick={onDelete}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-500 hover:border-red-500/60 hover:text-red-300"
              data-testid={`delete-${testCase.caseKey}`}
            >
              🗑
            </button>
          ) : null}
        </div>
      </div>

      {/* Sugerencia del scan automático */}
      {showSuggestion ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5">
          <span className="text-xs text-violet-200">
            💡 Sugerido: <strong>{STATUS_META[suggestion.status]?.label}</strong> — {suggestion.reason}
          </span>
          <button
            type="button"
            onClick={() => onStatus(suggestion.status)}
            className="rounded border border-violet-500/50 bg-violet-500/20 px-2 py-0.5 text-xs font-medium text-violet-100 hover:bg-violet-500/30"
          >
            Aplicar
          </button>
        </div>
      ) : null}

      {expanded && hasDetail ? (
        <div className="mt-3 rounded-lg border border-slate-800/60 bg-slate-950/40 px-4 py-3">
          <CaseDetail testCase={testCase} />
        </div>
      ) : null}

      <RunnerNotes key={testCase.caseKey} initial={run?.notes ?? ''} onSave={onNotes} />

      {/* Bug en Jira para casos fallados/bloqueados */}
      {canFileBug || existingIssue ? (
        <div className="mt-2">
          <ManualJiraBug
            scanId={scanId}
            testCase={testCase}
            runNotes={run?.notes}
            jira={jira}
            existingIssue={existingIssue}
            onCreated={onJiraCreated}
          />
        </div>
      ) : null}
    </li>
  );
}

/** Botón "Crear bug en Jira" para un caso manual con FAIL/BLOCKED. */
function ManualJiraBug({ scanId, testCase, runNotes, jira, existingIssue, onCreated }) {
  const [open, setOpen] = useState(false);
  const [projectKey, setProjectKey] = useState(jira?.defaultProjectKey || '');
  const [issueType, setIssueType] = useState(jira?.defaultIssueType || 'Bug');
  const [summary, setSummary] = useState(`[QA Forge] Caso manual FAIL — ${testCase.title}`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (existingIssue) {
    return (
      <a
        href={existingIssue.issueUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
        title={existingIssue.summary}
      >
        🐞 {existingIssue.issueKey} ↗
      </a>
    );
  }

  const handleCreate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const manualCase = {
        caseKey: testCase.caseKey,
        source: testCase.source,
        title: testCase.title,
        category: testCase.category,
        priority: testCase.priority,
        description: testCase.description ?? null,
        notes: runNotes ?? null,
        steps: testCase.source === 'ai' ? testCase.steps : undefined,
      };
      const issue = await createJiraIssue({
        scanId,
        manualCase,
        projectKey: projectKey.trim() || undefined,
        issueType: issueType.trim() || undefined,
        summary: summary.trim() || undefined,
      });
      setOpen(false);
      onCreated?.(issue);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo crear el bug en Jira');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
        data-testid={`jira-bug-btn-${testCase.caseKey}`}
      >
        🐞 Crear bug
      </button>
    );
  }

  return (
    <div className="w-full rounded-md border border-slate-700 bg-slate-950/70 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Proyecto</span>
          {jira?.projects?.length > 0 ? (
            <select
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">(elegir)</option>
              {jira.projects.map((p) => (
                <option key={p.id} value={p.key}>
                  {p.key} — {p.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              placeholder="ej: QA"
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          )}
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Tipo de issue</span>
          <input
            type="text"
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
            placeholder="Bug"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
          />
        </label>
      </div>
      <label className="mt-2 block">
        <span className="text-[10px] uppercase tracking-widest text-slate-500">Título</span>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          className="mt-1 w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
        />
      </label>
      <p className="mt-1 text-[10px] text-slate-500">
        La descripción se completa con el caso, los pasos y la nota de ejecución.
      </p>
      {error ? (
        <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting}
          className="rounded bg-emerald-500 px-3 py-1 text-xs font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
        >
          {submitting ? 'Creando…' : 'Crear bug en Jira'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={submitting}
          className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:text-slate-100"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Detalle del caso según su origen. */
function CaseDetail({ testCase }) {
  // Render estructurado (pasos/condiciones) para casos IA y de repositorio.
  const structured =
    testCase.steps?.length ||
    testCase.preconditions?.length ||
    testCase.postconditions?.length;
  if (structured) {
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

  const hasContent = value.trim().length > 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-slate-500 hover:text-emerald-300"
      >
        {hasContent ? '📝 Ver nota de ejecución' : '+ Nota de ejecución'}
      </button>
    );
  }
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-300"
      >
        <span>▾</span> Nota de ejecución
        <span className="text-slate-600">· ocultar</span>
      </button>
      <textarea
        rows={2}
        value={value}
        onChange={handleChange}
        placeholder="Nota de ejecución: qué pasó, evidencia, link al bug…"
        className="w-full resize-y rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </div>
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

/** Chip de filtro toggleable. */
function FilterChip({ active, onClick, tone, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? `border-emerald-500/60 bg-emerald-500/15 ${tone ?? 'text-emerald-300'}`
          : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500'
      }`}
    >
      {children}
    </button>
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

/** Panel para traer casos del repositorio de casos de prueba (FASE 10) al runner. */
function RepoImportPanel({ scanId, onImported }) {
  const [suts, setSuts] = useState([]);
  const [sutId, setSutId] = useState('');
  const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loadingCases, setLoadingCases] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    listSuts()
      .then((data) => setSuts(data ?? []))
      .catch((err) => setError(err?.response?.data?.message ?? err?.message ?? 'Error'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!sutId) {
      setCases([]);
      setSelected(new Set());
      return;
    }
    setLoadingCases(true);
    getSut(sutId)
      .then((data) => {
        setCases(data.testCases ?? []);
        setSelected(new Set((data.testCases ?? []).map((c) => c.id)));
      })
      .catch((err) => setError(err?.response?.data?.message ?? err?.message ?? 'Error'))
      .finally(() => setLoadingCases(false));
  }, [sutId]);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleImport = async () => {
    if (!selected.size) return;
    setImporting(true);
    setError(null);
    try {
      const data = await importRepoCasesToRunner(scanId, [...selected]);
      onImported(data.items ?? []);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo importar');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-sky-500/30 bg-slate-950/50 p-4">
      <p className="text-xs uppercase tracking-widest text-slate-500">
        Importar casos del repositorio
      </p>
      {loading ? (
        <p className="text-xs text-slate-500">Cargando SUTs…</p>
      ) : suts.length === 0 ? (
        <p className="text-xs text-slate-500">
          No hay software bajo prueba en el repositorio todavía.
        </p>
      ) : (
        <>
          <select
            value={sutId}
            onChange={(e) => setSutId(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none sm:w-80"
          >
            <option value="">Elegí un software bajo prueba…</option>
            {suts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.caseCount})
              </option>
            ))}
          </select>

          {loadingCases ? (
            <p className="text-xs text-slate-500">Cargando casos…</p>
          ) : sutId && cases.length === 0 ? (
            <p className="text-xs text-slate-500">Ese SUT no tiene casos.</p>
          ) : cases.length > 0 ? (
            <>
              <ul className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-900/40 p-2">
                {cases.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-mono text-slate-500">{c.code}</span> {c.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || selected.size === 0}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing
                  ? 'Importando…'
                  : `Importar ${selected.size} caso${selected.size === 1 ? '' : 's'}`}
              </button>
            </>
          ) : null}
        </>
      )}
      {error ? (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Editor de pasos (acción/esperado) para el formulario del runner. */
function StepRowsEditor({ steps, onChange }) {
  const setStep = (i, key, value) =>
    onChange(steps.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  const add = () => onChange([...steps, { action: '', expected: '' }]);
  const remove = (i) => onChange(steps.filter((_, idx) => idx !== i));
  const inputCls =
    'w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none';
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={i} className="flex gap-2 rounded-md border border-slate-800 bg-slate-950/60 p-2">
          <span className="pt-1.5 text-xs font-semibold text-emerald-400">{i + 1}.</span>
          <div className="flex-1 space-y-1">
            <input
              type="text"
              value={s.action}
              onChange={(e) => setStep(i, 'action', e.target.value)}
              placeholder="Acción"
              className={inputCls}
            />
            <input
              type="text"
              value={s.expected}
              onChange={(e) => setStep(i, 'expected', e.target.value)}
              placeholder="Resultado esperado"
              className={inputCls}
            />
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="self-start rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-500 hover:border-red-500/60 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-xs text-emerald-400 hover:text-emerald-300"
      >
        + Agregar paso
      </button>
    </div>
  );
}
