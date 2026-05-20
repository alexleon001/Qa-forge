// TestCaseEditor — formulario completo de un caso de prueba del repositorio
// (FASE 10). Sirve para crear y editar. Cubre todos los campos del modelo
// TestCase: pasos estructurados, pre/postcondiciones, tipo, prioridad, etc.

import { useState } from 'react';

export const TEST_TYPES = [
  'functional',
  'regression',
  'smoke',
  'integration',
  'acceptance',
  'exploratory',
  'negative',
  'usability',
];
export const CATEGORIES = ['functional', 'security', 'performance', 'accessibility', 'seo', 'ux'];
export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const STATUSES = ['draft', 'active', 'deprecated'];
export const AUTOMATION = ['not-automated', 'candidate', 'automated'];

const INPUT =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
const LABEL = 'block text-xs uppercase tracking-widest text-slate-500';

function emptyCase() {
  return {
    title: '',
    description: '',
    module: '',
    testType: 'functional',
    category: 'functional',
    priority: 'medium',
    status: 'active',
    preconditions: '',
    steps: [{ action: '', expected: '' }],
    postconditions: '',
    expectedResult: '',
    testData: '',
    tags: '',
    estimatedMinutes: '',
    automationStatus: 'not-automated',
    requirementRef: '',
    notes: '',
  };
}

/** Convierte un registro TestCase del backend al shape del formulario. */
function toForm(tc) {
  return {
    title: tc.title ?? '',
    description: tc.description ?? '',
    module: tc.module ?? '',
    testType: tc.testType ?? 'functional',
    category: tc.category ?? 'functional',
    priority: tc.priority ?? 'medium',
    status: tc.status ?? 'active',
    preconditions: (tc.preconditions ?? []).join('\n'),
    steps: (tc.steps ?? []).length ? tc.steps : [{ action: '', expected: '' }],
    postconditions: (tc.postconditions ?? []).join('\n'),
    expectedResult: tc.expectedResult ?? '',
    testData: tc.testData ?? '',
    tags: (tc.tags ?? []).join(', '),
    estimatedMinutes: tc.estimatedMinutes != null ? String(tc.estimatedMinutes) : '',
    automationStatus: tc.automationStatus ?? 'not-automated',
    requirementRef: tc.requirementRef ?? '',
    notes: tc.notes ?? '',
  };
}

const splitLines = (s) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function TestCaseEditor({ initial, onSubmit, onCancel, submitting, error }) {
  const [form, setForm] = useState(() => (initial ? toForm(initial) : emptyCase()));

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const setStep = (i, key, value) =>
    setForm((f) => {
      const steps = f.steps.map((s, idx) => (idx === i ? { ...s, [key]: value } : s));
      return { ...f, steps };
    });
  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, { action: '', expected: '' }] }));
  const removeStep = (i) =>
    setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const fields = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      module: form.module.trim() || null,
      testType: form.testType,
      category: form.category,
      priority: form.priority,
      status: form.status,
      preconditions: splitLines(form.preconditions),
      steps: form.steps
        .map((s) => ({ action: s.action.trim(), expected: s.expected.trim() }))
        .filter((s) => s.action || s.expected),
      postconditions: splitLines(form.postconditions),
      expectedResult: form.expectedResult.trim() || null,
      testData: form.testData.trim() || null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
      automationStatus: form.automationStatus,
      requirementRef: form.requirementRef.trim() || null,
      notes: form.notes.trim() || null,
    };
    onSubmit(fields);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-emerald-500/30 bg-slate-900/60 p-5"
      data-testid="test-case-editor"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-emerald-300">
          {initial ? `Editar ${initial.code}` : 'Nuevo caso de prueba'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Cancelar
        </button>
      </div>

      <div>
        <label className={LABEL}>Título *</label>
        <input
          type="text"
          value={form.title}
          onChange={set('title')}
          required
          maxLength={300}
          placeholder="Ej: Login con credenciales válidas"
          className={`mt-1 ${INPUT}`}
        />
      </div>

      <div>
        <label className={LABEL}>Descripción</label>
        <textarea
          rows={2}
          value={form.description}
          onChange={set('description')}
          placeholder="Qué verifica este caso"
          className={`mt-1 ${INPUT}`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Módulo / Feature">
          <input type="text" value={form.module} onChange={set('module')} className={INPUT} />
        </Field>
        <Field label="Tipo de prueba">
          <Select value={form.testType} onChange={set('testType')} options={TEST_TYPES} />
        </Field>
        <Field label="Categoría">
          <Select value={form.category} onChange={set('category')} options={CATEGORIES} />
        </Field>
        <Field label="Prioridad">
          <Select value={form.priority} onChange={set('priority')} options={PRIORITIES} />
        </Field>
        <Field label="Estado">
          <Select value={form.status} onChange={set('status')} options={STATUSES} />
        </Field>
        <Field label="Automatización">
          <Select
            value={form.automationStatus}
            onChange={set('automationStatus')}
            options={AUTOMATION}
          />
        </Field>
        <Field label="Duración est. (min)">
          <input
            type="number"
            min={0}
            value={form.estimatedMinutes}
            onChange={set('estimatedMinutes')}
            className={INPUT}
          />
        </Field>
        <Field label="Requerimiento / Ticket">
          <input
            type="text"
            value={form.requirementRef}
            onChange={set('requirementRef')}
            placeholder="JIRA-123"
            className={INPUT}
          />
        </Field>
      </div>

      <div>
        <label className={LABEL}>Precondiciones (una por línea)</label>
        <textarea
          rows={2}
          value={form.preconditions}
          onChange={set('preconditions')}
          placeholder="Usuario registrado&#10;Navegador en la home"
          className={`mt-1 ${INPUT}`}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className={LABEL}>Pasos</label>
          <button
            type="button"
            onClick={addStep}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            + Agregar paso
          </button>
        </div>
        <div className="mt-1 space-y-2">
          {form.steps.map((step, i) => (
            <div
              key={i}
              className="flex gap-2 rounded-md border border-slate-800 bg-slate-950/60 p-2"
            >
              <span className="pt-2 text-xs font-semibold text-emerald-400">{i + 1}.</span>
              <div className="flex-1 space-y-1">
                <textarea
                  rows={1}
                  value={step.action}
                  onChange={(e) => setStep(i, 'action', e.target.value)}
                  placeholder="Acción"
                  className={INPUT}
                />
                <textarea
                  rows={1}
                  value={step.expected}
                  onChange={(e) => setStep(i, 'expected', e.target.value)}
                  placeholder="Resultado esperado"
                  className={INPUT}
                />
              </div>
              {form.steps.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  className="self-start rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-500 hover:border-red-500/60 hover:text-red-300"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className={LABEL}>Postcondiciones (una por línea)</label>
        <textarea
          rows={2}
          value={form.postconditions}
          onChange={set('postconditions')}
          className={`mt-1 ${INPUT}`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Resultado esperado (global)">
          <textarea
            rows={2}
            value={form.expectedResult}
            onChange={set('expectedResult')}
            className={INPUT}
          />
        </Field>
        <Field label="Datos de prueba">
          <textarea rows={2} value={form.testData} onChange={set('testData')} className={INPUT} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tags (separados por coma)">
          <input
            type="text"
            value={form.tags}
            onChange={set('tags')}
            placeholder="login, smoke, crítico"
            className={INPUT}
          />
        </Field>
        <Field label="Notas">
          <input type="text" value={form.notes} onChange={set('notes')} className={INPUT} />
        </Field>
      </div>

      {error ? (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !form.title.trim()}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Guardando…' : initial ? 'Guardar cambios' : 'Crear caso'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={onChange} className={INPUT}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
