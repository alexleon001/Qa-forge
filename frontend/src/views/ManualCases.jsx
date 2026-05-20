// ManualCases — genera casos de prueba manuales con IA (FASE 6) y los ejecuta
// en el runner manual (FASE 9): checklist genérico + casos IA + casos custom.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  generateManualCases,
  getManualCases,
  getProviders,
} from '../lib/api.js';
import { ManualRunner } from '../components/ManualRunner.jsx';

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

  const hasCases = testCases.length > 0;

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
      if (status === 429) {
        setError(apiMsg ?? 'Cuota del provider agotada. Probá con otro provider en el dropdown.');
      } else if (status === 401) {
        setError(apiMsg ?? 'API key inválida o sin permisos para este modelo.');
      } else if (status === 503) {
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

      {/* Generación con IA — alimenta los casos "IA" del runner */}
      <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
        <h2 className="text-base font-semibold text-slate-100">🤖 Generar casos con IA</h2>
        <p className="mt-1 mb-4 text-xs text-slate-500">
          Genera una batería de casos a medida del sitio escaneado. Aparecen en el runner
          como casos <span className="text-violet-300">IA</span>, junto al checklist genérico.
        </p>

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
                ? 'Regenerar casos IA'
                : 'Generar casos con IA'}
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

      {/* Runner: checklist genérico + casos IA + casos custom */}
      {loading ? (
        <p className="mt-8 text-sm text-slate-500">Cargando…</p>
      ) : (
        <ManualRunner scanId={scanId} aiCases={testCases} />
      )}
    </section>
  );
}
