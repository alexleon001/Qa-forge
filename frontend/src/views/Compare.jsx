// Compare — diff de scores entre dos scans (a vs b). Lee ?a= y ?b= del query string.

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ScoreGauge } from '../components/ScoreGauge.jsx';
import { getReport } from '../lib/api.js';

const CATEGORY_LABEL = {
  functional: 'Funcional',
  security: 'Seguridad',
  performance: 'Performance',
  accessibility: 'Accesibilidad',
  seo: 'SEO',
};

const CATEGORY_ORDER = ['functional', 'security', 'performance', 'accessibility', 'seo'];

export function Compare() {
  const [searchParams] = useSearchParams();
  const idA = searchParams.get('a');
  const idB = searchParams.get('b');

  const [reportA, setReportA] = useState(null);
  const [reportB, setReportB] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!idA || !idB) {
      setError('Faltan parámetros ?a= y ?b= con los scan IDs a comparar.');
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getReport(idA), getReport(idB)])
      .then(([a, b]) => {
        if (cancelled) return;
        setReportA(a);
        setReportB(b);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'No se pudieron cargar los reportes');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [idA, idB]);

  const diff = useMemo(() => {
    if (!reportA || !reportB) return null;
    const rows = CATEGORY_ORDER.map((cat) => {
      const a = reportA.scoreByCategory?.[cat];
      const b = reportB.scoreByCategory?.[cat];
      if (typeof a !== 'number' && typeof b !== 'number') return null;
      const delta =
        typeof a === 'number' && typeof b === 'number' ? b - a : null;
      return { cat, a, b, delta };
    }).filter(Boolean);
    return rows;
  }, [reportA, reportB]);

  if (loading) {
    return (
      <section className="mx-auto max-w-5xl px-6 py-12 text-slate-400">
        Cargando reportes…
      </section>
    );
  }

  if (error) {
    return (
      <section className="mx-auto max-w-5xl px-6 py-12">
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-300">
          {error}
        </p>
        <Link to="/history" className="mt-4 inline-block text-sm text-emerald-400">
          ← Volver al historial
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-slate-500">comparar scans</p>
        <h1 className="text-2xl font-bold text-slate-50">
          Diff de scores
        </h1>
        <p className="mt-1 text-xs text-slate-500 break-all">
          {reportA?.scan.url}
          {reportA?.scan.url !== reportB?.scan.url
            ? ` ↔ ${reportB?.scan.url}`
            : ''}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <ScanSummary label="Scan A" report={reportA} tone="info" />
        <ScanSummary label="Scan B" report={reportB} tone="emerald" />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
          Scores por categoría
        </h2>
        {diff && diff.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-slate-800/70">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-xs uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Categoría</th>
                  <th className="px-4 py-2 text-right">A</th>
                  <th className="px-4 py-2 text-right">B</th>
                  <th className="px-4 py-2 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((row) => (
                  <tr key={row.cat} className="border-t border-slate-800/70">
                    <td className="px-4 py-3 text-slate-200">
                      {CATEGORY_LABEL[row.cat] || row.cat}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">{row.a ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{row.b ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      <DeltaCell delta={row.delta} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-500">
            Ninguno de los scans tiene scores numéricos para comparar.
          </p>
        )}
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <GaugesPanel label="Scan A" report={reportA} />
        <GaugesPanel label="Scan B" report={reportB} />
      </section>
    </section>
  );
}

function ScanSummary({ label, report, tone }) {
  if (!report) return null;
  const borderTone =
    tone === 'emerald'
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : 'border-blue-500/40 bg-blue-500/5';
  return (
    <div className={`rounded-xl border ${borderTone} p-4`}>
      <div className="text-xs uppercase tracking-widest text-slate-400">{label}</div>
      <div className="mt-1 break-all text-sm text-slate-100">{report.scan.url}</div>
      <div className="mt-2 flex gap-3 text-xs text-slate-400">
        <span>ID: {report.scan.id.slice(0, 10)}…</span>
        <span>·</span>
        <span>{new Date(report.scan.createdAt).toLocaleString()}</span>
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-300">
        <span>Total: {report.totals.total}</span>
        <span className="text-emerald-300">Pass: {report.totals.pass}</span>
        <span className="text-red-300">Fail: {report.totals.fail}</span>
        <span className="text-amber-300">Warn: {report.totals.warning}</span>
      </div>
    </div>
  );
}

function GaugesPanel({ label, report }) {
  const entries = Object.entries(report?.scoreByCategory ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
      <div className="mb-3 text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <div className="flex flex-wrap items-end gap-4">
        {entries.map(([cat, score]) => (
          <ScoreGauge
            key={cat}
            score={score}
            label={CATEGORY_LABEL[cat] || cat}
            size={72}
          />
        ))}
      </div>
    </div>
  );
}

function DeltaCell({ delta }) {
  if (delta == null) return <span className="text-slate-500">—</span>;
  if (delta === 0) return <span className="text-slate-400">0</span>;
  const sign = delta > 0 ? '+' : '';
  const tone = delta > 0 ? 'text-emerald-300' : 'text-red-300';
  return (
    <span className={tone}>
      {sign}
      {delta}
    </span>
  );
}
