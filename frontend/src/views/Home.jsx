// Home — input de URL + botón de scan. Crea el scan y redirige al Dashboard.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createScan } from '../lib/api.js';
import { useScanStore } from '../store/scan.store.js';

export function Home() {
  const [url, setUrl] = useState('https://');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const startScan = useScanStore((s) => s.startScan);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await createScan(url.trim());
      startScan({ scanId: data.scanId, url: data.url, status: data.status });
      navigate(`/scan/${data.scanId}`);
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'No se pudo iniciar el scan';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <div className="text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-50">
          Analiza cualquier URL en segundos
        </h1>
        <p className="mt-4 text-slate-400 max-w-xl mx-auto">
          QA Forge ejecuta pruebas funcionales y no funcionales sobre la URL que
          le pases, te muestra los hallazgos en tiempo real y genera scripts de
          Playwright, Cypress y Selenium listos para usar.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-stretch"
      >
        <input
          type="url"
          required
          placeholder="https://ejemplo.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          data-testid="home-url-input"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-500 px-6 py-3 font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="home-submit-btn"
        >
          {submitting ? 'Iniciando…' : 'Scan ahora'}
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-16 grid gap-4 sm:grid-cols-3">
        <FeatureCard
          title="Funcional"
          desc="Captura DOM, screenshot, links y forms con Playwright headless."
        />
        <FeatureCard
          title="Seguridad"
          desc="Headers HTTP, SSL/TLS, score de hardening 0-100."
        />
        <FeatureCard
          title="Scripts IA"
          desc="Playwright + Cypress + Selenium generados desde tu DOM."
        />
      </div>
    </section>
  );
}

function FeatureCard({ title, desc }) {
  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-5">
      <h3 className="font-semibold text-slate-100">{title}</h3>
      <p className="mt-2 text-sm text-slate-400">{desc}</p>
    </div>
  );
}
