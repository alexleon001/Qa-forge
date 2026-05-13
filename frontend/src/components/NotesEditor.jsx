// Editor de notas de QA con auto-save (debounce 800ms).

import { useEffect, useRef, useState } from 'react';

import { updateScan } from '../lib/api.js';

const SAVE_DEBOUNCE_MS = 800;

export function NotesEditor({ scanId, initialNotes }) {
  const [value, setValue] = useState(initialNotes ?? '');
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const lastSavedRef = useRef(initialNotes ?? '');

  // Si el prop cambia (al refrescar o cambiar de scan), sincronizamos.
  useEffect(() => {
    setValue(initialNotes ?? '');
    lastSavedRef.current = initialNotes ?? '';
  }, [scanId, initialNotes]);

  useEffect(() => {
    if (value === lastSavedRef.current) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSaving(true);
      setError(null);
      try {
        await updateScan(scanId, { notes: value });
        lastSavedRef.current = value;
        setSavedAt(new Date());
      } catch (err) {
        setError(err?.response?.data?.message ?? err?.message ?? 'Error al guardar');
      } finally {
        setSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
  }, [value, scanId]);

  return (
    <section className="mt-8 rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-300">
          Notas de QA
        </h2>
        <SaveStatus saving={saving} savedAt={savedAt} error={error} />
      </header>
      <textarea
        rows={6}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Observaciones, bugs detectados, pasos a reproducir, contexto del scan…"
        className="w-full resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        data-testid="notes-editor"
      />
      <p className="mt-2 text-xs text-slate-500">
        Auto-guardado · soporta texto libre. Máx 20.000 caracteres.
      </p>
    </section>
  );
}

function SaveStatus({ saving, savedAt, error }) {
  if (error) {
    return <span className="text-xs text-red-300">{error}</span>;
  }
  if (saving) {
    return <span className="text-xs text-slate-500">Guardando…</span>;
  }
  if (savedAt) {
    return (
      <span className="text-xs text-emerald-400">
        ✓ Guardado {savedAt.toLocaleTimeString()}
      </span>
    );
  }
  return null;
}
