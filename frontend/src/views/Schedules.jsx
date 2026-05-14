// Schedules — vista CRUD de scans programados por cron. Lista + form
// expandible. Soporta correr ahora, pausar/reanudar y borrar.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  runScheduleNow,
  updateSchedule,
  validateCronExpr,
} from '../lib/api.js';

const PRESET_CRONS = [
  { label: 'Cada hora', value: '0 * * * *' },
  { label: 'Cada 6h', value: '0 */6 * * *' },
  { label: 'Diario 9am', value: '0 9 * * *' },
  { label: 'Lun-Vie 9am', value: '0 9 * * 1-5' },
  { label: 'Semanal lunes 9am', value: '0 9 * * 1' },
];

const DEVICE_OPTIONS = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'desktop-1080p', label: 'Desktop FullHD' },
  { id: 'tablet', label: 'iPad Pro' },
  { id: 'iphone-13', label: 'iPhone 13' },
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro' },
  { id: 'pixel-7', label: 'Pixel 7' },
];
const ENGINE_OPTIONS = ['chromium', 'firefox', 'webkit'];

export function Schedules() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = async () => {
    try {
      const data = await listSchedules();
      setSchedules(data);
    } catch (err) {
      setError(err?.message ?? 'No se pudieron cargar los schedules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">scheduled scans</p>
          <h1 className="text-2xl font-bold text-slate-50">Scans programados</h1>
          <p className="mt-1 text-xs text-slate-500">
            Cron expressions estándar (5 campos). Notificación opcional por webhook (Slack/Discord)
            o email.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/20"
          data-testid="schedules-new-btn"
        >
          {showForm ? '× Cerrar form' : '+ Nuevo schedule'}
        </button>
      </header>

      {showForm ? (
        <ScheduleForm
          onCreated={async () => {
            setShowForm(false);
            await refresh();
          }}
        />
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : error ? (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
          {error}
        </p>
      ) : schedules.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
          Aún no tenés schedules. Creá uno con el botón "+ Nuevo schedule".
        </p>
      ) : (
        <ul className="space-y-3">
          {schedules.map((s) => (
            <ScheduleRow key={s.id} schedule={s} onChange={refresh} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduleRow({ schedule, onChange }) {
  const [busy, setBusy] = useState(false);
  const handleToggle = async () => {
    setBusy(true);
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  const handleRun = async () => {
    setBusy(true);
    try {
      await runScheduleNow(schedule.id);
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  const handleDelete = async () => {
    if (!confirm(`¿Borrar el schedule "${schedule.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteSchedule(schedule.id);
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-100">
            {schedule.name}{' '}
            {!schedule.enabled ? (
              <span className="ml-1 text-[10px] uppercase tracking-widest text-amber-300">
                pausado
              </span>
            ) : null}
          </h3>
          <p className="text-xs text-slate-500 break-all">{schedule.url}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={busy}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-50"
          >
            ▶ Correr ahora
          </button>
          <button
            type="button"
            onClick={handleToggle}
            disabled={busy}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
          >
            {schedule.enabled ? '⏸ Pausar' : '▶ Reanudar'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            🗑
          </button>
        </div>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-400 sm:grid-cols-4">
        <Field label="Cron" value={<code className="text-slate-200">{schedule.cron}</code>} />
        <Field label="TZ" value={schedule.timezone} />
        <Field label="Device" value={schedule.deviceProfile} />
        <Field label="Engine" value={schedule.browserEngine} />
        <Field
          label="Próximo run"
          value={schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : '—'}
        />
        <Field
          label="Último run"
          value={schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : 'nunca'}
        />
        <Field
          label="Último scan"
          value={
            schedule.lastScanId ? (
              <Link
                className="text-emerald-300 hover:underline"
                to={`/scan/${schedule.lastScanId}/report`}
              >
                ver reporte
              </Link>
            ) : (
              '—'
            )
          }
        />
        <Field label="Notify" value={schedule.notifyOn} />
      </dl>
      {(schedule.notifyWebhook || schedule.notifyEmail) ? (
        <p className="mt-2 text-[11px] text-slate-500">
          {schedule.notifyWebhook ? '🔔 webhook · ' : ''}
          {schedule.notifyEmail ? `✉ ${schedule.notifyEmail}` : ''}
        </p>
      ) : null}
    </li>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}: </span>
      <span className="text-slate-300">{value}</span>
    </div>
  );
}

function ScheduleForm({ onCreated }) {
  const [form, setForm] = useState({
    name: '',
    url: 'https://',
    cron: '0 9 * * *',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    deviceProfile: 'desktop',
    browserEngine: 'chromium',
    mode: 'single',
    maxPages: 1,
    notifyWebhook: '',
    notifyEmail: '',
    notifyOn: 'always',
  });
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => {
    const value = e?.target?.type === 'number' ? Number(e.target.value) : e?.target?.value ?? e;
    setForm((p) => ({ ...p, [k]: value }));
  };

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await validateCronExpr(form.cron, form.timezone);
        if (!cancelled) setPreview(r);
      } catch {
        if (!cancelled) setPreview({ valid: false, error: 'No se pudo validar' });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.cron, form.timezone]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = { ...form };
      if (!payload.notifyWebhook) delete payload.notifyWebhook;
      if (!payload.notifyEmail) delete payload.notifyEmail;
      await createSchedule(payload);
      await onCreated();
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo crear');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 space-y-4 rounded-xl border border-slate-800/70 bg-slate-900/40 p-5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nombre">
          <input
            required
            value={form.name}
            onChange={set('name')}
            placeholder="QA diario producción"
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </FormField>
        <FormField label="URL a scanear">
          <input
            required
            type="url"
            value={form.url}
            onChange={set('url')}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </FormField>
        <FormField label="Cron expression (5 campos)">
          <div className="flex flex-wrap gap-2">
            <input
              required
              value={form.cron}
              onChange={set('cron')}
              placeholder="0 9 * * *"
              className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              data-testid="schedule-cron"
            />
            <select
              onChange={(e) => set('cron')({ target: { value: e.target.value } })}
              value=""
              className="w-auto rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">presets…</option>
              {PRESET_CRONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} — {p.value}
                </option>
              ))}
            </select>
          </div>
          {preview ? (
            preview.valid ? (
              <p className="mt-1 text-[11px] text-emerald-300">
                ✓ próximo run: {new Date(preview.nextRunAt).toLocaleString()}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-red-300">✗ {preview.error}</p>
            )
          ) : null}
        </FormField>
        <FormField label="Timezone (IANA)">
          <input
            value={form.timezone}
            onChange={set('timezone')}
            placeholder="America/Argentina/Buenos_Aires"
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </FormField>
        <FormField label="Device">
          <select value={form.deviceProfile} onChange={set('deviceProfile')} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
            {DEVICE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Browser engine">
          <select value={form.browserEngine} onChange={set('browserEngine')} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
            {ENGINE_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Modo">
          <select value={form.mode} onChange={set('mode')} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
            <option value="single">single</option>
            <option value="crawl">crawl</option>
          </select>
        </FormField>
        {form.mode === 'crawl' ? (
          <FormField label="Máx páginas">
            <input
              type="number"
              min="1"
              max="15"
              value={form.maxPages}
              onChange={set('maxPages')}
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </FormField>
        ) : null}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-400">
          Notificaciones
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Webhook (Slack/Discord)">
            <input
              type="url"
              value={form.notifyWebhook}
              onChange={set('notifyWebhook')}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </FormField>
          <FormField label="Email">
            <input
              type="email"
              value={form.notifyEmail}
              onChange={set('notifyEmail')}
              placeholder="qa@empresa.com"
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </FormField>
          <FormField label="Disparar cuando">
            <select value={form.notifyOn} onChange={set('notifyOn')} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
              <option value="always">Siempre que termine</option>
              <option value="onWarningOrFail">Si hay warnings o fails</option>
              <option value="onFailOnly">Solo si hay fails</option>
            </select>
          </FormField>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Email requiere SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM en variables de entorno.
          Webhook funciona out-of-the-box.
        </p>
      </div>

      {error ? (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || (preview && !preview.valid)}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Creando…' : 'Crear schedule'}
        </button>
      </div>
    </form>
  );
}

function FormField({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-300">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
