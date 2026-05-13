// Botón que descarga el reporte en el formato indicado (json|html).

import { useState } from 'react';

import { downloadReport } from '../lib/api.js';

export function ExportButton({ scanId, format, label }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = async () => {
    setError(null);
    setBusy(true);
    try {
      await downloadReport(scanId, format);
    } catch (err) {
      setError(err?.message ?? 'No se pudo exportar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-stretch">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 transition hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-50"
        data-testid={`export-${format}-btn`}
      >
        {busy ? `Exportando…` : label || `Exportar ${format.toUpperCase()}`}
      </button>
      {error ? <span className="mt-1 text-xs text-red-300">{error}</span> : null}
    </div>
  );
}
