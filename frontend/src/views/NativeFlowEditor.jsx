// NativeFlowEditor — crear/editar un flujo de testing native (#15). Define las
// capabilities (provider, plataforma, device, app) + el step-builder con acciones
// native (tap/type/swipe/asserts) y estrategia de localización de Appium. Para
// flujos guardados muestra el historial de corridas + botón "Correr".

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  DEFAULT_NATIVE_STRATEGY,
  NATIVE_ACTION_META,
  NATIVE_LOCATOR_STRATEGIES,
  NATIVE_PLATFORMS,
} from '@shared/constants.js';
import {
  createNativeFlow,
  deleteNativeFlow,
  getNativeFlow,
  listNativeProviders,
  runNativeFlow,
  updateNativeFlow,
} from '../lib/api.js';

const PLATFORMS = Object.values(NATIVE_PLATFORMS);
const GROUPS = [
  { id: 'interaction', label: 'Interacción' },
  { id: 'wait', label: 'Esperas' },
  { id: 'assertion', label: 'Verificaciones' },
];
const RUN_STATUS_STYLE = {
  pending: 'text-slate-400',
  running: 'text-amber-300',
  passed: 'text-emerald-300',
  failed: 'text-red-300',
  error: 'text-red-400',
  cancelled: 'text-slate-500',
};

const emptyStep = () => ({ action: 'tap', strategy: DEFAULT_NATIVE_STRATEGY, selector: '', value: '', description: '' });

export function NativeFlowEditor() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [providers, setProviders] = useState([]);
  const [providerId, setProviderId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [platform, setPlatform] = useState('android');
  const [deviceName, setDeviceName] = useState('');
  const [platformVersion, setPlatformVersion] = useState('');
  const [app, setApp] = useState('');
  const [automationName, setAutomationName] = useState('');
  const [continueOnError, setContinueOnError] = useState(false);
  const [steps, setSteps] = useState([emptyStep()]);

  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    listNativeProviders()
      .then((p) => {
        setProviders(p ?? []);
        if (!isEdit && p?.[0]) setProviderId(p[0].id);
      })
      .catch(() => setProviders([]));
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    getNativeFlow(id)
      .then(({ flow, runs: flowRuns }) => {
        setProviderId(flow.providerId);
        setName(flow.name);
        setDescription(flow.description ?? '');
        setPlatform(flow.platform);
        setDeviceName(flow.deviceName);
        setPlatformVersion(flow.platformVersion ?? '');
        setApp(flow.app ?? '');
        setAutomationName(flow.automationName ?? '');
        setContinueOnError(Boolean(flow.continueOnError));
        setSteps(Array.isArray(flow.steps) && flow.steps.length ? flow.steps.map(normalizeStep) : [emptyStep()]);
        setRuns(flowRuns ?? []);
      })
      .catch((err) => setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo cargar'))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  const buildPayload = () => {
    const cleanSteps = steps.map((s) => {
      const meta = NATIVE_ACTION_META[s.action] ?? {};
      return {
        action: s.action,
        strategy: meta.needsSelector ? s.strategy || DEFAULT_NATIVE_STRATEGY : undefined,
        selector: meta.needsSelector ? s.selector.trim() : undefined,
        value: meta.needsValue ? s.value : undefined,
        description: s.description?.trim() || undefined,
      };
    });
    return {
      providerId,
      name: name.trim(),
      description: description.trim() || null,
      platform,
      deviceName: deviceName.trim(),
      platformVersion: platformVersion.trim() || null,
      app: app.trim() || null,
      automationName: automationName.trim() || null,
      continueOnError,
      steps: cleanSteps,
    };
  };

  const handleSave = async ({ thenRun } = {}) => {
    setError(null);
    setSaving(true);
    try {
      const payload = buildPayload();
      const flow = isEdit ? await updateNativeFlow(id, payload) : await createNativeFlow(payload);
      if (thenRun) {
        const run = await runNativeFlow(flow.id);
        navigate(`/native/runs/${run.id}`);
      } else if (!isEdit) {
        navigate(`/native/${flow.id}`);
      } else {
        const { runs: flowRuns } = await getNativeFlow(flow.id);
        setRuns(flowRuns ?? []);
      }
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Borrar este flujo native y sus corridas?')) return;
    await deleteNativeFlow(id).catch(() => {});
    navigate('/native');
  };

  if (loading) {
    return <section className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Cargando…</section>;
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <Link to="/native" className="text-xs text-slate-500 hover:text-slate-300">
          ← Flujos native
        </Link>
        <h1 className="text-2xl font-bold text-slate-50">{isEdit ? 'Editar flujo native' : 'Nuevo flujo native'}</h1>
      </header>

      {providers.length === 0 ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-4 text-sm text-amber-200">
          No tenés providers Appium.{' '}
          <Link to="/settings/native" className="underline">
            Configurá uno primero
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-5 rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-slate-400">
              Provider Appium
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className={inputCls}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.type})
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="block text-xs uppercase tracking-widest text-slate-500">Plataforma</span>
              <div className="mt-2 flex gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPlatform(p.id);
                      setAutomationName('');
                    }}
                    className={`rounded-md border px-3 py-1.5 text-xs ${
                      platform === p.id ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {p.icon} {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Field label="Nombre" value={name} onChange={setName} placeholder="Ej: Login en la app" testid="native-name" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Device name" value={deviceName} onChange={setDeviceName} placeholder="Pixel 7 / iPhone 14" />
            <Field label="Platform version (opc)" value={platformVersion} onChange={setPlatformVersion} placeholder="13.0" />
          </div>
          <Field
            label="App"
            value={app}
            onChange={setApp}
            placeholder="bs://… | storage:… | ruta/URL .apk/.ipa | appPackage (Android)"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="automationName (opc)"
              value={automationName}
              onChange={setAutomationName}
              placeholder={NATIVE_PLATFORMS[platform]?.defaultAutomation}
            />
            <Field label="Descripción (opc)" value={description} onChange={setDescription} placeholder="Qué cubre" />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={continueOnError} onChange={(e) => setContinueOnError(e.target.checked)} className="accent-emerald-500" />
            Continuar aunque un paso falle
          </label>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-slate-300">Pasos ({steps.length})</h2>
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <StepRow
                  key={i}
                  index={i}
                  step={step}
                  platform={platform}
                  onChange={(s) => setSteps(steps.map((x, j) => (j === i ? s : x)))}
                  onRemove={() => setSteps(steps.length > 1 ? steps.filter((_, j) => j !== i) : steps)}
                  onMove={(dir) => setSteps(moveItem(steps, i, dir))}
                  canMoveUp={i > 0}
                  canMoveDown={i < steps.length - 1}
                />
              ))}
            </ol>
            <button
              type="button"
              onClick={() => setSteps([...steps, emptyStep()])}
              className="mt-3 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
            >
              + Agregar paso
            </button>
          </div>

          {error ? <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || !providerId}
              onClick={() => handleSave({ thenRun: true })}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {saving ? '…' : '▶ Guardar y correr'}
            </button>
            <button
              type="button"
              disabled={saving || !providerId}
              onClick={() => handleSave()}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500 disabled:opacity-60"
            >
              {isEdit ? 'Guardar' : 'Guardar borrador'}
            </button>
            {isEdit ? (
              <button
                type="button"
                onClick={handleDelete}
                className="ml-auto rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
              >
                Borrar
              </button>
            ) : null}
          </div>
        </div>
      )}

      {isEdit ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-300">Corridas ({runs.length})</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no corriste este flujo.</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-2.5 text-xs">
                  <div>
                    <Link to={`/native/runs/${r.id}`} className={`font-medium ${RUN_STATUS_STYLE[r.status] ?? 'text-slate-300'} hover:underline`}>
                      {r.status}
                    </Link>
                    {r.summary ? (
                      <span className="ml-2 text-slate-500">
                        {r.summary.passed}/{r.summary.total} ok{r.summary.failed ? ` · ${r.summary.failed} fallaron` : ''}
                      </span>
                    ) : null}
                    {r.errorMessage ? <span className="ml-2 text-red-400/80">{r.errorMessage}</span> : null}
                  </div>
                  <span className="text-slate-600">{new Date(r.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}

const inputCls =
  'mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

function Field({ label, value, onChange, placeholder, testid }) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testid}
        className={inputCls}
      />
    </label>
  );
}

function StepRow({ index, step, platform, onChange, onRemove, onMove, canMoveUp, canMoveDown }) {
  const meta = useMemo(() => NATIVE_ACTION_META[step.action] ?? {}, [step.action]);
  const strategies = useMemo(() => NATIVE_LOCATOR_STRATEGIES.filter((s) => s.platforms.includes(platform)), [platform]);
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{index + 1}</span>
        <select
          value={step.action}
          onChange={(e) => onChange({ ...step, action: e.target.value })}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
        >
          {GROUPS.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {Object.entries(NATIVE_ACTION_META)
                .filter(([, m]) => m.group === g.id)
                .map(([action, m]) => (
                  <option key={action} value={action}>
                    {m.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <div className="ml-auto flex gap-1">
          <IconBtn disabled={!canMoveUp} onClick={() => onMove(-1)} title="Subir">↑</IconBtn>
          <IconBtn disabled={!canMoveDown} onClick={() => onMove(1)} title="Bajar">↓</IconBtn>
          <IconBtn onClick={onRemove} title="Quitar" danger>✕</IconBtn>
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {meta.needsSelector ? (
          <>
            <select
              value={step.strategy || DEFAULT_NATIVE_STRATEGY}
              onChange={(e) => onChange({ ...step, strategy: e.target.value })}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <input
              value={step.selector ?? ''}
              onChange={(e) => onChange({ ...step, selector: e.target.value })}
              placeholder="selector (id, accessibility id, xpath…)"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-500"
            />
          </>
        ) : null}
        {meta.needsValue ? (
          <input
            value={step.value ?? ''}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
            placeholder={meta.hint ?? 'valor'}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-500 sm:col-span-2"
          />
        ) : null}
        <input
          value={step.description ?? ''}
          onChange={(e) => onChange({ ...step, description: e.target.value })}
          placeholder="descripción (opcional)"
          className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-400 placeholder-slate-600 sm:col-span-2"
        />
      </div>
    </li>
  );
}

function IconBtn({ children, onClick, disabled, title, danger }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-1.5 py-0.5 text-[11px] disabled:opacity-30 ${
        danger ? 'border-red-500/40 text-red-300 hover:bg-red-500/10' : 'border-slate-700 text-slate-400 hover:border-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function normalizeStep(s) {
  return {
    action: s.action,
    strategy: s.strategy ?? DEFAULT_NATIVE_STRATEGY,
    selector: s.selector ?? '',
    value: s.value ?? '',
    description: s.description ?? '',
  };
}

function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = arr.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}
