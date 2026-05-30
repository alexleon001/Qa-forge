// FlowEditor — crear o editar un flujo e2e (Flow Runner determinista). Incluye el
// step-builder (acción + selector + valor + descripción, reordenable) y, para
// flujos ya guardados, un panel con el historial de corridas + botón "Correr".

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { FLOW_ACTION_META } from '@shared/constants.js';
import {
  createFlow,
  createFlowSchedule,
  deleteFlow,
  deleteFlowSchedule,
  exportFlowScript,
  getFlow,
  listFlowSchedules,
  runFlow,
  runFlowScheduleNow,
  updateFlow,
  updateFlowSchedule,
  validateCronExpr,
} from '../lib/api.js';

const DEVICE_OPTIONS = [
  { id: 'desktop', label: 'Desktop', icon: '🖥️' },
  { id: 'tablet', label: 'Tablet', icon: '📱' },
  { id: 'iphone-13', label: 'iPhone 13', icon: '📱' },
  { id: 'pixel-7', label: 'Pixel 7', icon: '🤖' },
];
const ENGINE_OPTIONS = [
  { id: 'chromium', label: 'Chromium', icon: '🟢' },
  { id: 'firefox', label: 'Firefox', icon: '🦊' },
  { id: 'webkit', label: 'WebKit', icon: '🧭' },
];

const RUN_STATUS_STYLE = {
  pending: 'text-slate-400',
  running: 'text-amber-300',
  passed: 'text-emerald-300',
  failed: 'text-red-300',
  error: 'text-red-400',
  cancelled: 'text-slate-500',
};

// Acciones agrupadas para el <optgroup> del selector de paso.
const GROUPS = [
  { id: 'navigation', label: 'Navegación' },
  { id: 'interaction', label: 'Interacción' },
  { id: 'wait', label: 'Esperas' },
  { id: 'assertion', label: 'Verificaciones' },
];

const emptyStep = () => ({ action: 'click', selector: '', value: '', description: '' });

export function FlowEditor() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('https://');
  const [deviceProfile, setDeviceProfile] = useState('desktop');
  const [browserEngine, setBrowserEngine] = useState('chromium');
  const [continueOnError, setContinueOnError] = useState(false);
  const [steps, setSteps] = useState([emptyStep()]);

  const [loginOpen, setLoginOpen] = useState(false);
  const [login, setLogin] = useState(emptyLogin());

  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    getFlow(id)
      .then(({ flow, runs: flowRuns }) => {
        setName(flow.name);
        setDescription(flow.description ?? '');
        setUrl(flow.url);
        setDeviceProfile(flow.deviceProfile);
        setBrowserEngine(flow.browserEngine);
        setContinueOnError(Boolean(flow.continueOnError));
        setSteps(Array.isArray(flow.steps) && flow.steps.length ? flow.steps.map(normalizeStep) : [emptyStep()]);
        if (flow.loginConfig) {
          setLogin({ ...emptyLogin(), ...flow.loginConfig, password: '' });
        }
        setRuns(flowRuns ?? []);
      })
      .catch((err) => setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo cargar el flujo'))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  const buildPayload = () => {
    const cleanSteps = steps.map((s) => {
      const meta = FLOW_ACTION_META[s.action] ?? {};
      return {
        action: s.action,
        selector: meta.needsSelector ? s.selector.trim() : undefined,
        value: meta.needsValue ? s.value : undefined,
        description: s.description?.trim() || undefined,
      };
    });
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      url: url.trim(),
      deviceProfile,
      browserEngine,
      continueOnError,
      steps: cleanSteps,
    };
    if (loginOpen && login.username && login.password) {
      payload.loginConfig = {
        url: (login.url || url).trim(),
        usernameSelector: login.usernameSelector.trim(),
        passwordSelector: login.passwordSelector.trim(),
        username: login.username,
        password: login.password,
        submitSelector: login.submitSelector.trim(),
        postLoginUrl: login.postLoginUrl?.trim() || undefined,
        waitForSelector: login.waitForSelector?.trim() || undefined,
      };
    }
    return payload;
  };

  const handleSave = async ({ thenRun } = {}) => {
    setError(null);
    setSaving(true);
    try {
      const payload = buildPayload();
      const flow = isEdit ? await updateFlow(id, payload) : await createFlow(payload);
      if (thenRun) {
        const run = await runFlow(flow.id);
        navigate(`/flows/runs/${run.id}`);
      } else if (!isEdit) {
        navigate(`/flows/${flow.id}`);
      } else {
        // refrescar runs/estado
        const { runs: flowRuns } = await getFlow(flow.id);
        setRuns(flowRuns ?? []);
      }
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Borrar este flujo y sus corridas?')) return;
    try {
      await deleteFlow(id);
      navigate('/flows');
    } catch {
      /* noop */
    }
  };

  if (loading) {
    return <section className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Cargando…</section>;
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <Link to="/flows" className="text-xs text-slate-500 hover:text-slate-300">
          ← Flujos
        </Link>
        <h1 className="text-2xl font-bold text-slate-50">{isEdit ? 'Editar flujo' : 'Nuevo flujo'}</h1>
      </header>

      <div className="space-y-5 rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
        <div>
          <label className="block text-xs uppercase tracking-widest text-slate-500">Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Login y compra"
            className={inputCls}
            data-testid="flow-name"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-slate-500">URL inicial</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://tu-sitio.com"
            className={inputCls}
            data-testid="flow-url"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-slate-500">Descripción (opcional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Qué cubre este flujo"
            className={inputCls}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <OptionGroup label="Device" options={DEVICE_OPTIONS} value={deviceProfile} onChange={setDeviceProfile} />
          <OptionGroup label="Engine" options={ENGINE_OPTIONS} value={browserEngine} onChange={setBrowserEngine} />
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={continueOnError}
            onChange={(e) => setContinueOnError(e.target.checked)}
            className="accent-emerald-500"
          />
          Continuar aunque un paso falle (por defecto corta en el primer fallo)
        </label>

        {/* Login pre-flight opcional */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/40">
          <button
            type="button"
            onClick={() => setLoginOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-slate-300"
          >
            <span>🔐 Login pre-flight (opcional)</span>
            <span className="text-slate-500">{loginOpen ? '−' : '+'}</span>
          </button>
          {loginOpen ? (
            <div className="grid gap-3 border-t border-slate-800 p-4 sm:grid-cols-2">
              <LoginField label="URL de login" value={login.url} onChange={(v) => setLogin({ ...login, url: v })} placeholder="(default: URL inicial)" />
              <LoginField label="Selector usuario" value={login.usernameSelector} onChange={(v) => setLogin({ ...login, usernameSelector: v })} placeholder="#email" />
              <LoginField label="Selector password" value={login.passwordSelector} onChange={(v) => setLogin({ ...login, passwordSelector: v })} placeholder="#password" />
              <LoginField label="Selector submit" value={login.submitSelector} onChange={(v) => setLogin({ ...login, submitSelector: v })} placeholder="button[type=submit]" />
              <LoginField label="Usuario" value={login.username} onChange={(v) => setLogin({ ...login, username: v })} placeholder="qa@example.com" />
              <LoginField label="Password" type="password" value={login.password} onChange={(v) => setLogin({ ...login, password: v })} placeholder={isEdit ? '(sin cambios)' : '••••••'} />
              <LoginField label="postLoginUrl (opc)" value={login.postLoginUrl} onChange={(v) => setLogin({ ...login, postLoginUrl: v })} placeholder="/dashboard" />
              <LoginField label="waitForSelector (opc)" value={login.waitForSelector} onChange={(v) => setLogin({ ...login, waitForSelector: v })} placeholder=".user-menu" />
            </div>
          ) : null}
        </div>

        {/* Step builder */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-300">
              Pasos ({steps.length})
            </h2>
          </div>
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <StepRow
                key={i}
                index={i}
                step={step}
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
            data-testid="flow-add-step"
          >
            + Agregar paso
          </button>
        </div>

        {error ? (
          <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave({ thenRun: true })}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            data-testid="flow-save-run"
          >
            {saving ? '…' : '▶ Guardar y correr'}
          </button>
          <button
            type="button"
            disabled={saving}
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

        {isEdit ? <ExportRow flowId={id} /> : null}
      </div>

      {/* Historial de corridas (solo en edición) */}
      {isEdit ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-300">
            Corridas ({runs.length})
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no corriste este flujo.</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-2.5 text-xs"
                >
                  <div>
                    <Link to={`/flows/runs/${r.id}`} className={`font-medium ${RUN_STATUS_STYLE[r.status] ?? 'text-slate-300'} hover:underline`}>
                      {r.status}
                    </Link>
                    {r.summary ? (
                      <span className="ml-2 text-slate-500">
                        {r.summary.passed}/{r.summary.total} ok
                        {r.summary.failed ? ` · ${r.summary.failed} fallaron` : ''}
                        {r.summary.durationMs ? ` · ${(r.summary.durationMs / 1000).toFixed(1)}s` : ''}
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

      {isEdit ? <FlowSchedules flowId={id} /> : null}
    </section>
  );
}

const inputCls =
  'mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

function StepRow({ index, step, onChange, onRemove, onMove, canMoveUp, canMoveDown }) {
  const meta = useMemo(() => FLOW_ACTION_META[step.action] ?? {}, [step.action]);
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
              {Object.entries(FLOW_ACTION_META)
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
          <input
            value={step.selector ?? ''}
            onChange={(e) => onChange({ ...step, selector: e.target.value })}
            placeholder="selector (CSS, text=…, xpath=…)"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-500"
          />
        ) : null}
        {meta.needsValue ? (
          <input
            value={step.value ?? ''}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
            placeholder={meta.hint ?? 'valor'}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-500"
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
        danger
          ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
          : 'border-slate-700 text-slate-400 hover:border-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function OptionGroup({ label, options, value, onChange }) {
  return (
    <div>
      <span className="block text-xs uppercase tracking-widest text-slate-500">{label}</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            type="button"
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${
              value === opt.id ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {opt.icon} {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LoginField({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-600"
      />
    </label>
  );
}

// Descarga texto como archivo en el browser.
function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ExportRow({ flowId }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const doExport = async (framework) => {
    setBusy(framework);
    setErr(null);
    try {
      const { content, filename } = await exportFlowScript(flowId, framework);
      downloadText(content, filename);
    } catch (e) {
      setErr(e?.response?.data?.message ?? e?.message ?? 'No se pudo exportar');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-2 border-t border-slate-800 pt-3">
      <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">Exportar a script (guardá primero los cambios)</p>
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'playwright', label: '⬇ Playwright (TS)' },
          { id: 'cypress', label: '⬇ Cypress (JS)' },
          { id: 'selenium', label: '⬇ Selenium (Py)' },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            disabled={busy === f.id}
            onClick={() => doExport(f.id)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-60"
          >
            {busy === f.id ? '…' : f.label}
          </button>
        ))}
      </div>
      {err ? <p className="mt-2 text-xs text-red-300">{err}</p> : null}
    </div>
  );
}

const CRON_PRESETS = [
  { label: 'Cada hora', cron: '0 * * * *' },
  { label: 'Diario 9am', cron: '0 9 * * *' },
  { label: 'Lun-Vie 8am', cron: '0 8 * * 1-5' },
  { label: 'Semanal (Lun 9am)', cron: '0 9 * * 1' },
];

function FlowSchedules({ flowId }) {
  const [schedules, setSchedules] = useState([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [notifyOn, setNotifyOn] = useState('onFailOnly');
  const [notifyWebhook, setNotifyWebhook] = useState('');
  const [notifyEmail, setNotifyEmail] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    listFlowSchedules()
      .then((all) => setSchedules((all ?? []).filter((s) => s.flowId === flowId)))
      .catch(() => setSchedules([]));
  };
  useEffect(reload, [flowId]);

  // Preview del próximo run cuando cambia la expresión.
  useEffect(() => {
    let active = true;
    validateCronExpr(cron, timezone)
      .then((r) => active && setPreview(r))
      .catch(() => active && setPreview(null));
    return () => {
      active = false;
    };
  }, [cron, timezone]);

  const create = async () => {
    setErr(null);
    setSaving(true);
    try {
      await createFlowSchedule({
        flowId,
        name: name.trim() || 'Schedule',
        cron: cron.trim(),
        timezone,
        notifyOn,
        notifyWebhook: notifyWebhook.trim() || null,
        notifyEmail: notifyEmail.trim() || null,
      });
      setOpen(false);
      setName('');
      reload();
    } catch (e) {
      setErr(e?.response?.data?.message ?? e?.message ?? 'No se pudo crear');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s) => {
    await updateFlowSchedule(s.id, { enabled: !s.enabled }).catch(() => {});
    reload();
  };
  const remove = async (s) => {
    if (!confirm('¿Borrar este schedule?')) return;
    await deleteFlowSchedule(s.id).catch(() => {});
    reload();
  };
  const runNow = async (s) => {
    await runFlowScheduleNow(s.id).catch(() => {});
    reload();
  };

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-300">Programación ({schedules.length})</h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
        >
          {open ? 'Cerrar' : '+ Programar'}
        </button>
      </div>

      {open ? (
        <div className="mb-4 space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-xs">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del schedule (ej: Regresión nocturna)"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 placeholder-slate-500"
          />
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.cron}
                type="button"
                onClick={() => setCron(p.cron)}
                className={`rounded border px-2 py-1 ${cron === p.cron ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * *"
              className="w-40 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-100"
            />
            <span className="text-slate-500">{timezone}</span>
          </div>
          <p className="text-slate-500">
            {preview?.valid
              ? `Próximo: ${new Date(preview.nextRunAt).toLocaleString()}`
              : preview
                ? `⚠ ${preview.error}`
                : '…'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500">Notificar:</span>
            {['onFailOnly', 'always'].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setNotifyOn(v)}
                className={`rounded border px-2 py-1 ${notifyOn === v ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                {v === 'onFailOnly' ? 'solo fallos' : 'siempre'}
              </button>
            ))}
          </div>
          <input
            value={notifyWebhook}
            onChange={(e) => setNotifyWebhook(e.target.value)}
            placeholder="Webhook Slack/Discord (opcional)"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 placeholder-slate-500"
          />
          <input
            value={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.value)}
            placeholder="Email (opcional, requiere SMTP)"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 placeholder-slate-500"
          />
          {err ? <p className="text-red-300">{err}</p> : null}
          <button
            type="button"
            disabled={saving || !preview?.valid}
            onClick={create}
            className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {saving ? '…' : 'Crear schedule'}
          </button>
        </div>
      ) : null}

      {schedules.length === 0 ? (
        <p className="text-sm text-slate-500">Sin schedules. Programá una corrida recurrente (regresión automática).</p>
      ) : (
        <ul className="space-y-2">
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-2.5 text-xs"
            >
              <div>
                <span className={`font-medium ${s.enabled ? 'text-slate-100' : 'text-slate-500 line-through'}`}>{s.name}</span>
                <span className="ml-2 font-mono text-slate-500">{s.cron}</span>
                {s.nextRunAt ? <span className="ml-2 text-slate-600">próx: {new Date(s.nextRunAt).toLocaleString()}</span> : null}
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => runNow(s)} className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300">
                  ▶ Ahora
                </button>
                <button type="button" onClick={() => toggle(s)} className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500">
                  {s.enabled ? 'Pausar' : 'Activar'}
                </button>
                <button type="button" onClick={() => remove(s)} className="rounded border border-red-500/40 px-2 py-1 text-red-300 hover:bg-red-500/10">
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function emptyLogin() {
  return {
    url: '',
    usernameSelector: '',
    passwordSelector: '',
    username: '',
    password: '',
    submitSelector: '',
    postLoginUrl: '',
    waitForSelector: '',
  };
}

function normalizeStep(s) {
  return { action: s.action, selector: s.selector ?? '', value: s.value ?? '', description: s.description ?? '' };
}

function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = arr.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}
