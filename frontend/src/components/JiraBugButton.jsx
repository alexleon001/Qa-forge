// Botón "Crear bug en Jira" para un Result con FAIL/WARNING (FASE 8.10).
// Si ya hay un bug creado para ese test, muestra el link al issue. Si no,
// abre un panel inline para elegir proyecto + editar el summary y crearlo.

import { useState } from 'react';

import { createJiraIssue } from '../lib/api.js';

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url ?? '';
  }
}

export function JiraBugButton({
  scanId,
  scanUrl,
  result,
  existingIssue,
  projects,
  defaultProjectKey,
  defaultIssueType,
  onCreated,
}) {
  const [open, setOpen] = useState(false);
  const [projectKey, setProjectKey] = useState(defaultProjectKey || '');
  const [issueType, setIssueType] = useState(defaultIssueType || 'Bug');
  const [summary, setSummary] = useState(
    `[QA Forge] ${result.category}/${result.testName} — ${String(
      result.status,
    ).toUpperCase()} en ${hostOf(scanUrl)}`,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Bug ya creado: link directo, sin panel.
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
      const issue = await createJiraIssue({
        scanId,
        resultId: result.id,
        projectKey: projectKey.trim() || undefined,
        issueType: issueType.trim() || undefined,
        summary: summary.trim() || undefined,
      });
      setOpen(false);
      onCreated?.(issue);
    } catch (err) {
      setError(
        err?.response?.data?.message ?? err?.message ?? 'No se pudo crear el bug en Jira',
      );
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
        data-testid={`jira-bug-btn-${result.testName}`}
      >
        🐞 Crear bug
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950/70 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Proyecto</span>
          {projects && projects.length > 0 ? (
            <select
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">(elegir)</option>
              {projects.map((p) => (
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
          <span className="text-[10px] uppercase tracking-widest text-slate-500">
            Tipo de issue
          </span>
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
        La descripción se completa automáticamente con la URL, los hallazgos del test
        y el link al reporte.
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
