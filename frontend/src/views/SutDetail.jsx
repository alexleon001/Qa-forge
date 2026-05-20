// SutDetail — detalle de un software bajo prueba: sus casos de prueba (CRUD
// completo), el chatbot de IA, e import de casos desde un scan (FASE 10).

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  createTestCase,
  deleteSut,
  deleteTestCase,
  getSut,
  importCasesFromScan,
  updateSut,
  updateTestCase,
} from '../lib/api.js';
import { CATEGORIES, PRIORITIES, STATUSES, TestCaseEditor } from '../components/TestCaseEditor.jsx';
import { RepoChat } from '../components/RepoChat.jsx';

const PRIORITY_TONE = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/40',
  high: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  medium: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};
const STATUS_TONE = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  draft: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  deprecated: 'bg-red-500/10 text-red-300/80 border-red-500/30',
};
const INPUT =
  'rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none';

export function SutDetail() {
  const { sutId } = useParams();
  const navigate = useNavigate();
  const [sut, setSut] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(null); // 'new' | caso | null
  const [savingCase, setSavingCase] = useState(false);
  const [caseError, setCaseError] = useState(null);

  const [showChat, setShowChat] = useState(false);
  const [editSut, setEditSut] = useState(false);

  const [importScanId, setImportScanId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);

  const [query, setQuery] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fStatus, setFStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSut(sutId)
      .then((data) => {
        if (cancelled) return;
        setSut(data.sut);
        setTestCases(data.testCases ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message ?? err?.message ?? 'Error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sutId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return testCases.filter((tc) => {
      if (fCategory && tc.category !== fCategory) return false;
      if (fPriority && tc.priority !== fPriority) return false;
      if (fStatus && tc.status !== fStatus) return false;
      if (q && !`${tc.code} ${tc.title}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [testCases, query, fCategory, fPriority, fStatus]);

  async function handleEditorSubmit(fields) {
    setSavingCase(true);
    setCaseError(null);
    try {
      if (editing === 'new') {
        const tc = await createTestCase(sutId, fields);
        setTestCases((prev) => [...prev, tc]);
      } else {
        const tc = await updateTestCase(editing.id, fields);
        setTestCases((prev) => prev.map((c) => (c.id === tc.id ? tc : c)));
      }
      setEditing(null);
    } catch (err) {
      setCaseError(err?.response?.data?.message ?? err?.message ?? 'No se pudo guardar el caso');
    } finally {
      setSavingCase(false);
    }
  }

  async function handleDeleteCase(tc) {
    if (!window.confirm(`¿Borrar ${tc.code} — ${tc.title}?`)) return;
    setTestCases((prev) => prev.filter((c) => c.id !== tc.id));
    try {
      await deleteTestCase(tc.id);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo borrar');
    }
  }

  async function handleImport() {
    const scanId = importScanId.trim();
    if (!scanId) return;
    setImporting(true);
    setImportMsg(null);
    setError(null);
    try {
      const data = await importCasesFromScan(sutId, scanId);
      setTestCases((prev) => [...prev, ...(data.testCases ?? [])]);
      setImportMsg(`${data.imported} caso(s) importado(s) del scan.`);
      setImportScanId('');
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo importar');
    } finally {
      setImporting(false);
    }
  }

  async function handleSaveSut(patch) {
    try {
      const updated = await updateSut(sutId, patch);
      setSut(updated);
      setEditSut(false);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo guardar el SUT');
    }
  }

  async function handleDeleteSut() {
    if (!window.confirm(`¿Borrar "${sut.name}" y sus ${testCases.length} casos?`)) return;
    try {
      await deleteSut(sutId);
      navigate('/repository');
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo borrar el SUT');
    }
  }

  if (loading) {
    return <section className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">Cargando…</section>;
  }
  if (!sut) {
    return (
      <section className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-red-300">{error ?? 'SUT no encontrado'}</p>
        <Link to="/repository" className="mt-4 inline-block text-sm text-emerald-300">
          ← Volver al repositorio
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <Link to="/repository" className="text-xs text-slate-500 hover:text-slate-300">
        ← Repositorio
      </Link>

      {/* Header del SUT */}
      {editSut ? (
        <SutEditForm sut={sut} onSave={handleSaveSut} onCancel={() => setEditSut(false)} />
      ) : (
        <header className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50">{sut.name}</h1>
            {sut.description ? (
              <p className="mt-1 text-sm text-slate-400">{sut.description}</p>
            ) : null}
            {sut.baseUrl ? <p className="mt-0.5 text-xs text-slate-600">{sut.baseUrl}</p> : null}
            <p className="mt-1 text-xs text-slate-500">
              {testCases.length} caso{testCases.length === 1 ? '' : 's'} de prueba
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditSut(true)}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 hover:border-emerald-500/60"
            >
              Editar SUT
            </button>
            <button
              type="button"
              onClick={handleDeleteSut}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-400 hover:border-red-500/60 hover:text-red-300"
            >
              Borrar SUT
            </button>
          </div>
        </header>
      )}

      {error ? (
        <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setEditing('new');
            setCaseError(null);
          }}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
        >
          + Nuevo caso
        </button>
        <button
          type="button"
          onClick={() => setShowChat((v) => !v)}
          className="rounded-lg border border-violet-500/40 px-4 py-2 text-sm text-violet-300 hover:bg-violet-500/10"
        >
          🤖 {showChat ? 'Cerrar asistente' : 'Asistente IA'}
        </button>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={importScanId}
            onChange={(e) => setImportScanId(e.target.value)}
            placeholder="scanId a importar"
            className={`${INPUT} w-44 py-1.5 text-xs`}
          />
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || !importScanId.trim()}
            className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 hover:border-emerald-500/60 disabled:opacity-60"
          >
            {importing ? 'Importando…' : 'Importar de scan'}
          </button>
        </div>
        {importMsg ? <span className="text-xs text-emerald-400">{importMsg}</span> : null}
      </div>

      {/* Chatbot */}
      {showChat ? (
        <div className="mt-4">
          <RepoChat sutId={sutId} testCases={testCases} onApplied={(fresh) => setTestCases(fresh)} />
        </div>
      ) : null}

      {/* Editor de caso */}
      {editing ? (
        <div className="mt-4">
          <TestCaseEditor
            initial={editing === 'new' ? null : editing}
            onSubmit={handleEditorSubmit}
            onCancel={() => setEditing(null)}
            submitting={savingCase}
            error={caseError}
          />
        </div>
      ) : null}

      {/* Filtros */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por código o título…"
          className={`${INPUT} py-1.5 text-xs`}
        />
        <FilterSelect value={fCategory} onChange={setFCategory} options={CATEGORIES} all="Categoría" />
        <FilterSelect value={fPriority} onChange={setFPriority} options={PRIORITIES} all="Prioridad" />
        <FilterSelect value={fStatus} onChange={setFStatus} options={STATUSES} all="Estado" />
        <span className="text-xs text-slate-500">
          {filtered.length}/{testCases.length}
        </span>
      </div>

      {/* Lista de casos */}
      <div className="mt-4 space-y-3">
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-8 text-center text-sm text-slate-400">
            {testCases.length === 0
              ? 'Sin casos todavía. Creá uno, importá de un scan o pedíselo al asistente IA.'
              : 'Ningún caso coincide con el filtro.'}
          </p>
        ) : (
          filtered.map((tc) => (
            <CaseCard
              key={tc.id}
              testCase={tc}
              onEdit={() => {
                setEditing(tc);
                setCaseError(null);
              }}
              onDelete={() => handleDeleteCase(tc)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function CaseCard({ testCase: tc, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="overflow-hidden rounded-xl border border-slate-800/70 bg-slate-900/40">
      <div className="flex items-start justify-between gap-3 px-5 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-500">{tc.code}</span>
            <Badge className={PRIORITY_TONE[tc.priority]}>{tc.priority}</Badge>
            <Badge className={STATUS_TONE[tc.status]}>{tc.status}</Badge>
            <Badge className="border-slate-600 bg-slate-700/40 text-slate-300">{tc.category}</Badge>
            <Badge className="border-violet-500/40 bg-violet-500/10 text-violet-300">
              {tc.testType}
            </Badge>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-slate-100 hover:text-emerald-300">
            {tc.title} <span className="text-xs text-slate-500">{open ? '▲' : '▾'}</span>
          </h3>
        </button>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-emerald-500/60 hover:text-emerald-300"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-500 hover:border-red-500/60 hover:text-red-300"
          >
            🗑
          </button>
        </div>
      </div>

      {open ? (
        <div className="space-y-3 border-t border-slate-800/70 px-5 py-4 text-sm">
          {tc.description ? <p className="text-slate-300">{tc.description}</p> : null}
          {tc.module ? (
            <p className="text-xs text-slate-500">
              Módulo: <span className="text-slate-300">{tc.module}</span>
            </p>
          ) : null}
          <Section title="Precondiciones" items={tc.preconditions} />
          {tc.steps?.length ? (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500">Pasos</p>
              <ol className="mt-1 space-y-1.5">
                {tc.steps.map((s, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-slate-800/60 bg-slate-950/40 px-3 py-2 text-slate-200"
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
            </div>
          ) : null}
          <Section title="Postcondiciones" items={tc.postconditions} />
          {tc.expectedResult ? (
            <p className="text-xs text-slate-400">
              <span className="font-semibold text-slate-500">Resultado esperado: </span>
              {tc.expectedResult}
            </p>
          ) : null}
          {tc.testData ? (
            <p className="text-xs text-slate-400">
              <span className="font-semibold text-slate-500">Datos de prueba: </span>
              {tc.testData}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3 text-xs text-slate-500">
            <span>Automatización: {tc.automationStatus}</span>
            {tc.estimatedMinutes != null ? <span>· {tc.estimatedMinutes} min</span> : null}
            {tc.requirementRef ? <span>· Ref: {tc.requirementRef}</span> : null}
          </div>
          {tc.tags?.length ? (
            <div className="flex flex-wrap gap-1">
              {tc.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-slate-700 bg-slate-800/50 px-2 py-0.5 text-[10px] text-slate-400"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          {tc.notes ? <p className="text-xs italic text-slate-500">Notas: {tc.notes}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function Section({ title, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-300">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function Badge({ className, children }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-widest ${className}`}
    >
      {children}
    </span>
  );
}

function FilterSelect({ value, onChange, options, all }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${INPUT} py-1.5 text-xs`}
    >
      <option value="">{all}: todas</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function SutEditForm({ sut, onSave, onCancel }) {
  const [name, setName] = useState(sut.name);
  const [description, setDescription] = useState(sut.description ?? '');
  const [baseUrl, setBaseUrl] = useState(sut.baseUrl ?? '');
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-emerald-500/30 bg-slate-900/60 p-4">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={`${INPUT} w-full`}
        placeholder="Nombre"
      />
      <textarea
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className={`${INPUT} w-full`}
        placeholder="Descripción"
      />
      <input
        type="text"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        className={`${INPUT} w-full`}
        placeholder="URL principal"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            onSave({
              name: name.trim(),
              description: description.trim() || null,
              baseUrl: baseUrl.trim() || null,
            })
          }
          disabled={!name.trim()}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
