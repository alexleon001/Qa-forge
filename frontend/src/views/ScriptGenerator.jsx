// ScriptGenerator — genera/visualiza scripts PW/Cypress/Selenium para un scan.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ScriptViewer } from '../components/ScriptViewer.jsx';
import { generateScripts, getProviders, getScripts } from '../lib/api.js';

const FRAMEWORK_LABEL = {
  playwright: 'Playwright',
  cypress: 'Cypress',
  selenium: 'Selenium',
};

const FRAMEWORK_ORDER = ['playwright', 'cypress', 'selenium'];

export function ScriptGenerator() {
  const { scanId } = useParams();
  const [scripts, setScripts] = useState([]);
  const [active, setActive] = useState('playwright');
  const [additionalCases, setAdditionalCases] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [usageNote, setUsageNote] = useState(null);
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);

  // Cargar scripts existentes + lista de providers configurados.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getScripts(scanId).catch((err) => {
        if (err?.response?.status === 404) return { scripts: [] };
        throw err;
      }),
      getProviders().catch(() => ({ providers: [], defaultProvider: null })),
    ])
      .then(([scriptsData, providersData]) => {
        if (cancelled) return;
        setScripts(scriptsData.scripts ?? []);
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
        if (!cancelled) setError(err?.message ?? 'Error cargando scripts');
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
      const data = await generateScripts(scanId, {
        additionalCases: additionalCases.trim() || null,
        force,
        provider: selectedProvider,
      });
      setScripts(data.scripts);
      const providerLabel = data.provider ? ` · ${data.provider}` : '';
      if (data.cached) {
        setUsageNote('Scripts recuperados del cache local (no se llamó a la API).');
      } else if (data.usage) {
        const inputTokens = data.usage.input_tokens ?? 0;
        const outputTokens = data.usage.output_tokens ?? 0;
        const cacheRead = data.usage.cache_read_input_tokens;
        const cachePart =
          cacheRead != null ? ` · cache read: ${cacheRead}` : '';
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
        setError(apiMsg ?? err?.message ?? 'No se pudo generar los scripts');
      }
    } finally {
      setGenerating(false);
    }
  };

  const activeScript = scripts.find((s) => s.framework === active);
  const hasScripts = scripts.length > 0;

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">script generator</p>
          <h1 className="text-2xl font-bold text-slate-50">Scripts E2E automatizados</h1>
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
            to={`/scan/${scanId}/manual-cases`}
            className="rounded-md border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10"
          >
            Casos manuales
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
                <option
                  key={p.id}
                  value={p.id}
                  disabled={!p.configured}
                >
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
          placeholder="Ej: agregar test que verifique mensaje de error al ingresar email inválido en el form de signup"
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          data-testid="additional-cases-input"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={generating || loading}
            onClick={() => handleGenerate({ force: hasScripts })}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="generate-scripts-btn"
          >
            {generating
              ? 'Generando…'
              : hasScripts
                ? 'Regenerar scripts'
                : 'Generar scripts'}
          </button>
          {usageNote ? <span className="text-xs text-slate-500">{usageNote}</span> : null}
        </div>
        {error ? (
          <p
            className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            data-testid="script-generator-error"
          >
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-8 text-sm text-slate-500">Cargando…</p>
      ) : hasScripts ? (
        <div className="mt-8">
          <div className="flex gap-1 border-b border-slate-800/70">
            {FRAMEWORK_ORDER.filter((f) => scripts.some((s) => s.framework === f)).map(
              (f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActive(f)}
                  className={`px-4 py-2 text-sm font-medium transition ${
                    active === f
                      ? 'border-b-2 border-emerald-500 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  data-testid={`script-tab-${f}`}
                >
                  {FRAMEWORK_LABEL[f]}
                </button>
              ),
            )}
          </div>
          <div className="mt-4">
            {activeScript ? (
              <ScriptViewer script={activeScript} />
            ) : (
              <p className="text-sm text-slate-500">No hay script para este framework.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-8 rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
          Todavía no hay scripts generados para este scan. Tocá <em>Generar scripts</em>
          {' '}para producir los 3 frameworks (la primera llamada tarda 10-30 s).
        </p>
      )}
    </section>
  );
}
