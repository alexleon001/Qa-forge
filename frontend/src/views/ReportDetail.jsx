// ReportDetail — vista de reporte completo con scores por categoría,
// gauges, lista de tests y botones de export.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ExportButton } from '../components/ExportButton.jsx';
import { NotesEditor } from '../components/NotesEditor.jsx';
import { ScanTimer } from '../components/ScanTimer.jsx';
import { ScoreGauge } from '../components/ScoreGauge.jsx';
import { TestCard } from '../components/TestCard.jsx';
import { getReport, getScan } from '../lib/api.js';

const CATEGORY_LABEL = {
  functional: 'Funcional',
  security: 'Seguridad',
  performance: 'Performance',
  accessibility: 'Accesibilidad',
  seo: 'SEO',
};

const CATEGORY_ORDER = ['functional', 'security', 'performance', 'accessibility', 'seo'];

export function ReportDetail() {
  const { scanId } = useParams();
  const [report, setReport] = useState(null);
  const [scanMeta, setScanMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getReport(scanId),
      getScan(scanId).catch(() => null),
    ])
      .then(([reportData, scanData]) => {
        if (cancelled) return;
        setReport(reportData);
        setScanMeta(scanData);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'No se pudo cargar el reporte');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  if (loading) {
    return (
      <section className="mx-auto max-w-5xl px-6 py-12 text-slate-400">
        Cargando reporte…
      </section>
    );
  }

  if (error || !report) {
    return (
      <section className="mx-auto max-w-5xl px-6 py-12">
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-300">
          {error ?? 'Reporte no disponible'}
        </p>
        <Link to="/" className="mt-4 inline-block text-sm text-emerald-400 hover:underline">
          ← Volver al inicio
        </Link>
      </section>
    );
  }

  const { scan, totals, scoreByCategory, byCategory } = report;
  const visibleCategories = CATEGORY_ORDER.filter(
    (cat) => (byCategory[cat]?.length ?? 0) > 0,
  );

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">reporte</p>
          <h1 className="text-3xl font-bold text-slate-50 break-all">{scan.url}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>ID: {scan.id} · Status: {scan.status}</span>
            {scan.completedAt ? (
              <span>· {new Date(scan.completedAt).toLocaleString()}</span>
            ) : null}
            <DeviceBadge report={report} />
          </p>
          {scanMeta?.startedAt ? (
            <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <span className="uppercase tracking-widest">duración:</span>
              <ScanTimer
                startedAt={scanMeta.startedAt}
                endedAt={scanMeta.completedAt}
                status={scanMeta.status}
              />
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <ExportButton scanId={scanId} format="json" label="Exportar JSON" />
          <ExportButton scanId={scanId} format="html" label="Exportar HTML" />
          <Link
            to={`/scan/${scanId}/scripts`}
            className="rounded-md border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10"
            data-testid="goto-scripts-from-report-btn"
          >
            Scripts E2E
          </Link>
          <Link
            to={`/scan/${scanId}/manual-cases`}
            className="rounded-md border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10"
            data-testid="goto-manual-cases-from-report-btn"
          >
            Casos manuales
          </Link>
          <Link
            to={`/scan/${scanId}`}
            className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
          >
            Ver progreso
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Total" value={totals.total} tone="info" />
        <SummaryTile label="Pass" value={totals.pass} tone="pass" />
        <SummaryTile label="Fail" value={totals.fail} tone="fail" />
        <SummaryTile label="Warning" value={totals.warning} tone="warning" />
      </div>

      {Object.keys(scoreByCategory).length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Scores por categoría
          </h2>
          <div className="flex flex-wrap items-end gap-6 rounded-xl border border-slate-800/70 bg-slate-900/40 px-6 py-5">
            {CATEGORY_ORDER.filter((cat) => typeof scoreByCategory[cat] === 'number').map(
              (cat) => (
                <ScoreGauge
                  key={cat}
                  score={scoreByCategory[cat]}
                  label={CATEGORY_LABEL[cat] || cat}
                />
              ),
            )}
          </div>
        </section>
      ) : null}

      <NotesEditor scanId={scanId} initialNotes={scanMeta?.notes ?? ''} />

      {visibleCategories.map((cat) => (
        <CategorySection
          key={cat}
          title={CATEGORY_LABEL[cat] || cat}
          score={scoreByCategory[cat]}
          results={byCategory[cat]}
        />
      ))}
    </section>
  );
}

function DeviceBadge({ report }) {
  const capture = report?.byCategory?.functional?.find?.(
    (r) => r.testName === 'playwright.capture',
  );
  const device = capture?.details?.device;
  if (!device?.label) return null;
  return (
    <span
      className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300"
      title={`Viewport: ${device.viewport?.width}×${device.viewport?.height}`}
    >
      {device.isMobile ? '📱' : '🖥️'} {device.label}
    </span>
  );
}

function SummaryTile({ label, value, tone }) {
  const colors = {
    info: 'text-blue-300',
    pass: 'text-emerald-300',
    fail: 'text-red-300',
    warning: 'text-amber-300',
  };
  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-900/60 px-4 py-3">
      <div className="text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${colors[tone]}`}>{value}</div>
    </div>
  );
}

function CategorySection({ title, score, results }) {
  return (
    <section className="mt-8">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          {title}
        </h2>
        {typeof score === 'number' ? (
          <span className="text-xs text-slate-500">score promedio: {score}</span>
        ) : null}
      </header>
      <ul className="space-y-3">
        {results.map((result) => (
          <TestCard key={result.id} result={result} />
        ))}
      </ul>
    </section>
  );
}
