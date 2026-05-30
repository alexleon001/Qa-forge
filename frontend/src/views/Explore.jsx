// Explore — AI exploratory testing. Lanza una sesión exploratoria sobre una URL
// (el agente maneja el browser y reporta hallazgos) y lista las sesiones previas.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { createExploration, deleteExploration, listExplorations } from '../lib/api.js';

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
const MAX_EXPLORE_STEPS = 40;

const STATUS_STYLE = {
  pending: 'text-slate-400',
  running: 'text-amber-300',
  completed: 'text-emerald-300',
  failed: 'text-red-300',
  cancelled: 'text-slate-500',
};

export function Explore() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('https://');
  const [goal, setGoal] = useState('');
  const [maxSteps, setMaxSteps] = useState(15);
  const [deviceProfile, setDeviceProfile] = useState('desktop');
  const [browserEngine, setBrowserEngine] = useState('chromium');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    listExplorations()
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await createExploration({
        url: url.trim(),
        goal: goal.trim() || null,
        maxSteps: Number(maxSteps),
        deviceProfile,
        browserEngine,
      });
      navigate(`/explore/${session.id}`);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo iniciar la sesión');
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Borrar esta sesión exploratoria?')) return;
    try {
      await deleteExploration(id);
      reload();
    } catch {
      /* noop */
    }
  };

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-slate-500">ai exploratory testing</p>
        <h1 className="text-2xl font-bold text-slate-50">Exploración autónoma</h1>
        <p className="mt-1 text-sm text-slate-400">
          Un agente de IA maneja un navegador real sobre tu sitio, decide qué probar paso a
          paso y reporta los problemas que encuentra (errores de consola/HTTP + hallazgos).
        </p>
      </header>

      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
        <label className="block text-xs uppercase tracking-widest text-slate-500">URL a explorar</label>
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://tu-sitio.com"
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          data-testid="explore-url"
        />

        <label className="mt-4 block text-xs uppercase tracking-widest text-slate-500">
          Objetivo (opcional)
        </label>
        <textarea
          rows={2}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Ej: explorá el flujo de registro y los formularios principales"
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <span className="block text-xs uppercase tracking-widest text-slate-500">Device</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEVICE_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setDeviceProfile(opt.id)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs ${
                    deviceProfile === opt.id
                      ? 'border-emerald-500 text-emerald-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-xs uppercase tracking-widest text-slate-500">Engine</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {ENGINE_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setBrowserEngine(opt.id)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs ${
                    browserEngine === opt.id
                      ? 'border-emerald-500 text-emerald-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="mt-4 block text-xs uppercase tracking-widest text-slate-500">
          Máximo de pasos: <span className="text-emerald-300">{maxSteps}</span>
        </label>
        <input
          type="range"
          min={3}
          max={MAX_EXPLORE_STEPS}
          value={maxSteps}
          onChange={(e) => setMaxSteps(e.target.value)}
          className="mt-2 w-full accent-emerald-500"
        />

        {error ? (
          <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="explore-start-btn"
        >
          {submitting ? 'Iniciando…' : 'Iniciar exploración'}
        </button>
      </form>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-300">
          Sesiones previas ({sessions.length})
        </h2>
        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : sessions.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-500">
            Todavía no corriste ninguna exploración.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link to={`/explore/${s.id}`} className="text-sm font-medium text-slate-100 hover:text-emerald-300">
                    {s.url}
                  </Link>
                  <p className="text-xs text-slate-500">
                    <span className={STATUS_STYLE[s.status] ?? 'text-slate-400'}>{s.status}</span>
                    {' · '}
                    {s.currentStep}/{s.maxSteps} pasos
                    {s.summary?.findingsBySeverity
                      ? ` · ${Object.values(s.summary.findingsBySeverity).reduce((a, b) => a + b, 0)} hallazgos`
                      : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/explore/${s.id}`}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                  >
                    Ver
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
