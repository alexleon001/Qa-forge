// ManualCases — genera/visualiza casos de prueba manuales para un scan (FASE 6).

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  generateManualCases,
  getManualCases,
  getProviders,
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

export function ManualCases() {
  const { scanId } = useParams();
  const [testCases, setTestCases] = useState([]);
  const [additionalCases, setAdditionalCases] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [usageNote, setUsageNote] = useState(null);
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [openCategories, setOpenCategories] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getManualCases(scanId).catch((err) => {
        if (err?.response?.status === 404) return { testCases: [] };
        throw err;
      }),
      getProviders().catch(() => ({ providers: [], defaultProvider: null })),
    ])
      .then(([manualData, providersData]) => {
        if (cancelled) return;
        setTestCases(manualData.testCases ?? []);
        setProviders(providersData.providers ?? []);
        const configured = (providersData.providers ?? []).filter((p) => p.configured);
        const pick =
          configured.find((p) => p.id === providersData.defaultProvider)?.id ??
          configured[0]?.id ??
          providersData.defaultProvider ??
          null;
        setSelectedProvider(pick);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Error cargando casos manuales');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const handleGenerate = async ({ force = false } = {}) => {
    setError(null);
    setGenerating(true);
    setUsageNote(null);
    try {
      const data = await generateManualCases(scanId, {
        additionalCases: additionalCases.trim() || null,
        force,
        provider: selectedProvider,
      });
      setTestCases(data.testCases ?? []);
      const providerLabel = data.provider ? ` · ${data.provider}` : '';
      if (data.cached) {
        setUsageNote('Casos recuperados del cache local (no se llamó a la API).');
      } else if (data.usage) {
        const inputTokens = data.usage.input_tokens ?? 0;
        const outputTokens = data.usage.output_tokens ?? 0;
        const cacheRead = data.usage.cache_read_input_tokens;
        const cachePart = cacheRead != null ? ` · cache read: ${cacheRead}` : '';
        setUsageNote(
          `${inputTokens} in / ${outputTokens} out tokens${cachePart}${providerLabel}`,
        );
      } else if (data.provider) {
        setUsageNote(`Generado con ${data.provider}.`);
      }
    } catch (err) {
      const status = err?.response?.status;
      const apiMsg = err?.response?.data?.message;
      if (status === 503) {
        setError(
          apiMsg ??
            'Provider no configurado. Setear la API key correspondiente en backend/.env (o levantar Ollama).',
        );
      } else if (status === 409) {
        setError(apiMsg ?? 'El scan todavía no completó la captura del DOM.');
      } else {
        setError(apiMsg ?? err?.message ?? 'No se pudieron generar los casos manuales');
      }
    } finally {
      setGenerating(false);
    }
  };

  const grouped = useMemo(() => groupByCategory(testCases), [testCases]);
  const hasCases = testCases.length > 0;

  const toggleCategory = (cat) =>
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));

  const handleExportJson = () => downloadBlob(
    JSON.stringify(testCases, null, 2),
    `qa-forge-manual-cases-${scanId}.json`,
    'application/json',
  );

  const handleExportMarkdown = () => downloadBlob(
    toMarkdown(testCases),
    `qa-forge-manual-cases-${scanId}.md`,
    'text/markdown',
  );

  const handleExportCsv = () => downloadBlob(
    toCsv(testCases),
    `qa-forge-manual-cases-${scanId}.csv`,
    'text/csv',
  );

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">manual test cases</p>
          <h1 className="text-2xl font-bold text-slate-50">Casos de prueba manuales</h1>
          <p className="mt-1 text-xs text-slate-500">Scan: {scanId}</p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/scan/${scanId}/report`}
            className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
          >
            Ver reporte
          </Link>
          <Link
            to={`/scan/${scanId}/scripts`}
            className="rounded-md border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10"
          >
            Scripts E2E
          </Link>
        </div>
      </header>

      <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
        {providers.length > 0 ? (
          <div className="mb-4">
            <label className="block text-xs uppercase tracking-widest text-slate-500">
              Provider de IA
            </label>
            <select
              value={selectedProvider ?? ''}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:w-80"
              data-testid="provider-select"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.configured}>
                  {p.label} ({p.defaultModel}){p.configured ? '' : ' — no configurado'}
                  {p.isDefault ? ' · default' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Configurar API keys en <code>backend/.env</code>. Ollama corre local
              en <code>:11434</code> (gratis, sin red).
            </p>
          </div>
        ) : null}

        <label className="block text-xs uppercase tracking-widest text-slate-500">
          Casos adicionales (opcional)
        </label>
        <textarea
          rows={3}
          value={additionalCases}
          onChange={(e) => setAdditionalCases(e.target.value)}
          placeholder="Ej: probar flujo de recuperación de contraseña con email inexistente"
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          data-testid="additional-cases-input"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={generating || loading}
            onClick={() => handleGenerate({ force: hasCases })}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="generate-manual-cases-btn"
          >
            {generating
              ? 'Generando…'
              : hasCases
                ? 'Regenerar casos'
                : 'Generar casos manuales'}
          </button>
          {usageNote ? <span className="text-xs text-slate-500">{usageNote}</span> : null}
        </div>
        {error ? (
          <p
            className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            data-testid="manual-cases-error"
          >
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-8 text-sm text-slate-500">Cargando…</p>
      ) : hasCases ? (
        <>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-400">
              {testCases.length} caso{testCases.length === 1 ? '' : 's'} de prueba
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleExportMarkdown}
                className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
                data-testid="export-md-btn"
              >
                Exportar MD
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
                data-testid="export-csv-btn"
              >
                Exportar CSV
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
                data-testid="export-json-btn"
              >
                Exportar JSON
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => {
              const cases = grouped[cat];
              const isOpen = openCategories[cat] !== false; // default abierto
              return (
                <section
                  key={cat}
                  className="overflow-hidden rounded-xl border border-slate-800/70 bg-slate-900/40"
                >
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-slate-900/70"
                    data-testid={`category-toggle-${cat}`}
                  >
                    <div>
                      <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-200">
                        {CATEGORY_LABEL[cat] || cat}
                      </h2>
                      <p className="text-xs text-slate-500">
                        {cases.length} caso{cases.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span className="text-slate-400">{isOpen ? '−' : '+'}</span>
                  </button>
                  {isOpen ? (
                    <ul className="divide-y divide-slate-800/60 border-t border-slate-800/70">
                      {cases.map((tc) => (
                        <TestCaseRow key={tc.id} testCase={tc} />
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <p className="mt-8 rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
          Todavía no hay casos manuales generados para este scan. Tocá{' '}
          <em>Generar casos manuales</em> para producir la batería completa
          (la primera llamada tarda 10-30 s).
        </p>
      )}
    </section>
  );
}

function TestCaseRow({ testCase }) {
  const priorityClass = PRIORITY_TONE[testCase.priority] ?? PRIORITY_TONE.medium;
  return (
    <li className="px-5 py-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-mono text-slate-500">{testCase.id}</p>
          <h3 className="text-base font-semibold text-slate-100">{testCase.title}</h3>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest ${priorityClass}`}
        >
          {testCase.priority}
        </span>
      </header>

      {testCase.preconditions?.length ? (
        <section className="mt-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Precondiciones</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-300">
            {testCase.preconditions.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {testCase.steps?.length ? (
        <section className="mt-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Pasos</p>
          <ol className="mt-1 space-y-2">
            {testCase.steps.map((s, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-800/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200"
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
        </section>
      ) : null}

      {testCase.postconditions?.length ? (
        <section className="mt-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Postcondiciones</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-300">
            {testCase.postconditions.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {testCase.testData ? (
        <p className="mt-3 text-xs text-slate-400">
          <span className="font-semibold text-slate-500">Datos de prueba: </span>
          {testCase.testData}
        </p>
      ) : null}

      {testCase.notes ? (
        <p className="mt-2 text-xs italic text-slate-500">Notas: {testCase.notes}</p>
      ) : null}
    </li>
  );
}

function groupByCategory(cases) {
  const out = {};
  for (const tc of cases) {
    const cat = tc.category || 'functional';
    if (!out[cat]) out[cat] = [];
    out[cat].push(tc);
  }
  return out;
}

function toMarkdown(cases) {
  const lines = ['# Casos de prueba manuales', ''];
  for (const tc of cases) {
    lines.push(`## ${tc.id} — ${tc.title}`);
    lines.push('');
    lines.push(`- **Categoría**: ${tc.category}`);
    lines.push(`- **Prioridad**: ${tc.priority}`);
    if (tc.preconditions?.length) {
      lines.push('', '**Precondiciones**:');
      tc.preconditions.forEach((p) => lines.push(`- ${p}`));
    }
    if (tc.steps?.length) {
      lines.push('', '**Pasos**:');
      tc.steps.forEach((s, i) => {
        lines.push(`${i + 1}. ${s.action}`);
        lines.push(`   - _Esperado_: ${s.expected}`);
      });
    }
    if (tc.postconditions?.length) {
      lines.push('', '**Postcondiciones**:');
      tc.postconditions.forEach((p) => lines.push(`- ${p}`));
    }
    if (tc.testData) lines.push('', `**Datos de prueba**: ${tc.testData}`);
    if (tc.notes) lines.push('', `**Notas**: ${tc.notes}`);
    lines.push('', '---', '');
  }
  return lines.join('\n');
}

function toCsv(cases) {
  const header = ['id', 'title', 'category', 'priority', 'preconditions', 'steps', 'postconditions', 'testData', 'notes'];
  const rows = [header.join(',')];
  for (const tc of cases) {
    const stepsText = (tc.steps || [])
      .map((s, i) => `${i + 1}. ${s.action} → ${s.expected}`)
      .join(' | ');
    const row = [
      tc.id,
      tc.title,
      tc.category,
      tc.priority,
      (tc.preconditions || []).join(' | '),
      stepsText,
      (tc.postconditions || []).join(' | '),
      tc.testData ?? '',
      tc.notes ?? '',
    ].map(csvEscape);
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
