// History — lista los scans pasados (paginados), agrupa por URL, links a
// report/scripts/compare. Carga incremental con botón "Cargar más".

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listScans } from '../lib/api.js';

const STATUS_TONE = {
  completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  running: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  pending: 'border-slate-600 bg-slate-800 text-slate-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-300',
};

export function History() {
  const [scans, setScans] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  // Carga una página. `append` decide si suma a la lista o la reemplaza.
  const loadPage = useCallback(async (page, append) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const { scans: rows, pagination: pg } = await listScans({ page });
      setScans((prev) => (append ? [...prev, ...rows] : rows));
      setPagination(pg);
    } catch (err) {
      setError(err?.message ?? 'No se pudieron cargar los scans');
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage(1, false);
  }, [loadPage]);

  // Agrupar por URL para facilitar la comparación entre scans de la misma URL.
  // El filtro opera solo sobre los scans ya cargados en memoria.
  const grouped = useMemo(() => {
    const filtered = query.trim()
      ? scans.filter((s) => s.url.toLowerCase().includes(query.trim().toLowerCase()))
      : scans;
    const byUrl = new Map();
    for (const s of filtered) {
      const list = byUrl.get(s.url) ?? [];
      list.push(s);
      byUrl.set(s.url, list);
    }
    return Array.from(byUrl.entries()).map(([url, items]) => ({
      url,
      items: items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    }));
  }, [scans, query]);

  const hasMore = Boolean(pagination?.hasMore);

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">historial</p>
          <h1 className="text-2xl font-bold text-slate-50">Scans pasados</h1>
          <p className="mt-1 text-xs text-slate-500">
            {pagination
              ? `Mostrando ${scans.length} de ${pagination.total} scans`
              : `Mostrando ${scans.length} scans`}
          </p>
        </div>
        <input
          type="search"
          placeholder="Filtrar por URL…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:w-72"
          data-testid="history-filter"
        />
      </header>

      {query.trim() && hasMore ? (
        <p className="mb-4 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
          El filtro solo busca entre los {scans.length} scans cargados. Usá “Cargar más”
          para incluir el resto.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : error ? (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-300">
          {error}
        </p>
      ) : grouped.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
          {scans.length === 0
            ? 'Todavía no hay scans. Volvé al inicio para iniciar uno.'
            : 'Ningún scan coincide con el filtro.'}
        </p>
      ) : (
        <ul className="space-y-6">
          {grouped.map(({ url, items }) => (
            <li
              key={url}
              className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-5"
            >
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="break-all text-sm font-semibold text-slate-100">{url}</h2>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{items.length} scan(s)</span>
                  {items.length >= 2 ? (
                    <Link
                      to={`/compare?a=${items[1].id}&b=${items[0].id}`}
                      className="rounded border border-emerald-500/40 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/10"
                      data-testid={`compare-latest-${encodeURIComponent(url)}`}
                    >
                      Comparar últimos 2
                    </Link>
                  ) : null}
                </div>
              </header>
              <ul className="divide-y divide-slate-800/70">
                {items.map((scan) => (
                  <li
                    key={scan.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-widest ${
                          STATUS_TONE[scan.status] ?? STATUS_TONE.pending
                        }`}
                      >
                        {scan.status}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(scan.createdAt).toLocaleString()}
                      </span>
                      <code className="text-[11px] text-slate-500">{scan.id}</code>
                      {scan.mode === 'crawl' ? (
                        <span
                          className="rounded border border-emerald-500/40 bg-emerald-500/5 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-emerald-300"
                          title={`Crawl multi-página · hasta ${scan.maxPages} páginas`}
                        >
                          🕷️ crawl
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Link
                        to={`/scan/${scan.id}`}
                        className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                      >
                        Progreso
                      </Link>
                      <Link
                        to={`/scan/${scan.id}/report`}
                        className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                      >
                        Reporte
                      </Link>
                      <Link
                        to={`/scan/${scan.id}/scripts`}
                        className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                      >
                        Scripts
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => loadPage(pagination.page + 1, true)}
            disabled={loadingMore}
            className="rounded-lg border border-slate-700 bg-slate-900/60 px-5 py-2 text-sm text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="history-load-more"
          >
            {loadingMore
              ? 'Cargando…'
              : `Cargar más (${pagination.total - scans.length} restantes)`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
