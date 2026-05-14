// Home — input de URL + opciones avanzadas (device, crawler, login). Crea el
// scan y redirige al Dashboard.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createScan } from '../lib/api.js';
import { useScanStore } from '../store/scan.store.js';

const DEVICE_OPTIONS = [
  { id: 'desktop', label: 'Desktop (1366×768)', icon: '🖥️' },
  { id: 'desktop-1080p', label: 'Desktop FullHD', icon: '🖥️' },
  { id: 'tablet', label: 'Tablet (iPad)', icon: '📱' },
  { id: 'iphone-13', label: 'iPhone 13', icon: '📱' },
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro', icon: '📱' },
  { id: 'pixel-7', label: 'Pixel 7 (Android)', icon: '🤖' },
];

const MAX_CRAWL_PAGES = 15;

export function Home() {
  const [url, setUrl] = useState('https://');
  const [deviceProfile, setDeviceProfile] = useState('desktop');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Modo crawl
  const [crawlEnabled, setCrawlEnabled] = useState(false);
  const [maxPages, setMaxPages] = useState(5);

  // Login pre-flight
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [loginCfg, setLoginCfg] = useState({
    url: '',
    usernameSelector: '',
    passwordSelector: '',
    username: '',
    password: '',
    submitSelector: '',
    postLoginUrl: '',
    waitForSelector: '',
  });

  const navigate = useNavigate();
  const startScan = useScanStore((s) => s.startScan);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = { deviceProfile };
      if (crawlEnabled) {
        payload.mode = 'crawl';
        payload.maxPages = Math.min(Math.max(Number(maxPages) || 1, 1), MAX_CRAWL_PAGES);
      }
      if (loginEnabled) {
        // Solo mandamos los campos no vacíos; los opcionales se omiten
        payload.loginConfig = {
          url: loginCfg.url.trim(),
          usernameSelector: loginCfg.usernameSelector.trim(),
          passwordSelector: loginCfg.passwordSelector.trim(),
          username: loginCfg.username,
          password: loginCfg.password,
          submitSelector: loginCfg.submitSelector.trim(),
        };
        if (loginCfg.postLoginUrl.trim()) payload.loginConfig.postLoginUrl = loginCfg.postLoginUrl.trim();
        if (loginCfg.waitForSelector.trim()) payload.loginConfig.waitForSelector = loginCfg.waitForSelector.trim();
      }
      const data = await createScan(url.trim(), payload);
      startScan({ scanId: data.scanId, url: data.url, status: data.status });
      navigate(`/scan/${data.scanId}`);
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'No se pudo iniciar el scan';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const setLoginField = (field) => (e) => {
    setLoginCfg((prev) => ({ ...prev, [field]: e.target.value }));
  };

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <div className="text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-50">
          Analiza cualquier URL en segundos
        </h1>
        <p className="mt-4 text-slate-400 max-w-xl mx-auto">
          QA Forge ejecuta pruebas funcionales y no funcionales sobre la URL que
          le pases, te muestra los hallazgos en tiempo real y genera scripts de
          Playwright, Cypress y Selenium listos para usar.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-10 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <input
            type="url"
            required
            placeholder="https://ejemplo.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            data-testid="home-url-input"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-emerald-500 px-6 py-3 font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="home-submit-btn"
          >
            {submitting ? 'Iniciando…' : 'Scan ahora'}
          </button>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">
            Dispositivo a emular
          </p>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            data-testid="device-selector"
          >
            {DEVICE_OPTIONS.map((opt) => {
              const active = deviceProfile === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDeviceProfile(opt.id)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                    active
                      ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                      : 'border-slate-700 bg-slate-900/40 text-slate-300 hover:border-slate-600'
                  }`}
                  data-testid={`device-${opt.id}`}
                >
                  <span aria-hidden>{opt.icon}</span>
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Crawler multi-página */}
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/30">
          <button
            type="button"
            onClick={() => setCrawlEnabled((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            data-testid="crawl-toggle"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <span aria-hidden>🕷️</span>
              Crawler multi-página
              {crawlEnabled ? (
                <span className="ml-2 rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                  ON
                </span>
              ) : null}
            </span>
            <span className="text-slate-500">{crawlEnabled ? '▲' : '▼'}</span>
          </button>
          {crawlEnabled ? (
            <div className="space-y-3 border-t border-slate-800/60 px-4 py-4">
              <p className="text-xs text-slate-400">
                Descubre URLs vía <code className="text-emerald-300">sitemap.xml</code> o links
                internos del DOM y corre el pipeline completo en cada una.
              </p>
              <label className="block text-sm">
                <span className="text-slate-300">
                  Máximo de páginas (1–{MAX_CRAWL_PAGES})
                </span>
                <input
                  type="number"
                  min="1"
                  max={MAX_CRAWL_PAGES}
                  value={maxPages}
                  onChange={(e) => setMaxPages(e.target.value)}
                  className="mt-1 w-32 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
                  data-testid="crawl-maxpages"
                />
              </label>
            </div>
          ) : null}
        </div>

        {/* Login pre-flight */}
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/30">
          <button
            type="button"
            onClick={() => setLoginEnabled((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            data-testid="login-toggle"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <span aria-hidden>🔐</span>
              Scan con autenticación
              {loginEnabled ? (
                <span className="ml-2 rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                  ON
                </span>
              ) : null}
            </span>
            <span className="text-slate-500">{loginEnabled ? '▲' : '▼'}</span>
          </button>
          {loginEnabled ? (
            <div className="space-y-3 border-t border-slate-800/60 px-4 py-4">
              <p className="text-xs text-slate-400">
                Antes del scan, abrimos el browser en la URL de login, rellenamos el form
                con tus credenciales y guardamos las cookies. La password se cifra
                AES-256-GCM en la DB.
              </p>
              <LoginField
                label="URL de login"
                placeholder="https://app.example.com/login"
                value={loginCfg.url}
                onChange={setLoginField('url')}
                type="url"
                testid="login-url"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <LoginField
                  label="Selector campo usuario (CSS)"
                  placeholder="input[name=email]"
                  value={loginCfg.usernameSelector}
                  onChange={setLoginField('usernameSelector')}
                  testid="login-userSel"
                />
                <LoginField
                  label="Selector campo password (CSS)"
                  placeholder="input[type=password]"
                  value={loginCfg.passwordSelector}
                  onChange={setLoginField('passwordSelector')}
                  testid="login-passSel"
                />
                <LoginField
                  label="Usuario"
                  value={loginCfg.username}
                  onChange={setLoginField('username')}
                  testid="login-user"
                  autoComplete="off"
                />
                <LoginField
                  label="Password"
                  value={loginCfg.password}
                  onChange={setLoginField('password')}
                  type="password"
                  testid="login-pass"
                  autoComplete="off"
                />
                <LoginField
                  label="Selector botón submit (CSS)"
                  placeholder="button[type=submit]"
                  value={loginCfg.submitSelector}
                  onChange={setLoginField('submitSelector')}
                  testid="login-submitSel"
                />
                <LoginField
                  label="Post-login URL (opcional)"
                  placeholder="https://app.example.com/**"
                  value={loginCfg.postLoginUrl}
                  onChange={setLoginField('postLoginUrl')}
                  testid="login-postUrl"
                />
              </div>
              <LoginField
                label="Selector a esperar tras submit (opcional, si no hay redirect)"
                placeholder=".dashboard, [data-testid=user-menu]"
                value={loginCfg.waitForSelector}
                onChange={setLoginField('waitForSelector')}
                testid="login-waitSel"
              />
            </div>
          ) : null}
        </div>
      </form>

      {error ? (
        <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-16 grid gap-4 sm:grid-cols-3">
        <FeatureCard
          title="Funcional"
          desc="Captura DOM, screenshot, links y forms con Playwright headless."
        />
        <FeatureCard
          title="Seguridad"
          desc="Headers HTTP, SSL/TLS, score de hardening 0-100."
        />
        <FeatureCard
          title="Scripts IA"
          desc="Playwright + Cypress + Selenium generados desde tu DOM."
        />
      </div>
    </section>
  );
}

function LoginField({ label, value, onChange, placeholder, type = 'text', testid, autoComplete }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        data-testid={testid}
      />
    </label>
  );
}

function FeatureCard({ title, desc }) {
  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-5">
      <h3 className="font-semibold text-slate-100">{title}</h3>
      <p className="mt-2 text-sm text-slate-400">{desc}</p>
    </div>
  );
}
