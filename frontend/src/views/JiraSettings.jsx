// Configuración de la integración con Jira (FASE 8.10). El API token se cifra
// en el backend (AES-256-GCM); solo se muestra un hint. Permite probar la
// conexión y elegir un proyecto default para los bugs.

import { useEffect, useState } from 'react';

import {
  deleteJiraConfig,
  getJiraConfig,
  listJiraProjects,
  saveJiraConfig,
  testJiraConnection,
} from '../lib/api.js';

function errMsg(err, fallback) {
  return err?.response?.data?.message ?? err?.message ?? fallback;
}

export function JiraSettings() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [hint, setHint] = useState(null);

  // Form
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [defaultProjectKey, setDefaultProjectKey] = useState('');
  const [defaultIssueType, setDefaultIssueType] = useState('Bug');

  const [projects, setProjects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const { configured: isCfg, config } = await getJiraConfig();
      setConfigured(isCfg);
      if (config) {
        setBaseUrl(config.baseUrl ?? '');
        setEmail(config.email ?? '');
        setHint(config.hint ?? null);
        setDefaultProjectKey(config.defaultProjectKey ?? '');
        setDefaultIssueType(config.defaultIssueType ?? 'Bug');
      }
    } catch (err) {
      setError(errMsg(err, 'Error cargando la configuración'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  // Cargar la lista de proyectos una vez que hay config válida.
  const loadProjects = async () => {
    try {
      setProjects(await listJiraProjects());
    } catch {
      // Silencioso: el dropdown cae a input de texto libre.
      setProjects([]);
    }
  };

  useEffect(() => {
    if (configured) loadProjects();
  }, [configured]);

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const payload = { baseUrl, email };
      if (token.trim()) payload.token = token.trim();
      const { user } = await testJiraConnection(payload);
      setNotice(`Conexión OK — autenticado como ${user.displayName || user.emailAddress}`);
      await loadProjects();
    } catch (err) {
      setError(errMsg(err, 'No se pudo conectar con Jira'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        baseUrl: baseUrl.trim(),
        email: email.trim(),
        defaultProjectKey: defaultProjectKey.trim() || null,
        defaultIssueType: defaultIssueType.trim() || 'Bug',
      };
      if (token.trim()) payload.token = token.trim();
      await saveJiraConfig(payload);
      setToken('');
      setNotice('Configuración guardada.');
      await reload();
    } catch (err) {
      setError(errMsg(err, 'No se pudo guardar la configuración'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Borrar la configuración de Jira? Los bugs ya creados no se tocan.')) return;
    setError(null);
    setNotice(null);
    try {
      await deleteJiraConfig();
      setBaseUrl('');
      setEmail('');
      setToken('');
      setHint(null);
      setDefaultProjectKey('');
      setDefaultIssueType('Bug');
      setProjects([]);
      setConfigured(false);
      setNotice('Configuración eliminada.');
    } catch (err) {
      setError(errMsg(err, 'No se pudo borrar'));
    }
  };

  if (loading) {
    return <section className="mx-auto max-w-3xl px-6 py-12 text-slate-400">Cargando…</section>;
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-slate-500">settings</p>
        <h1 className="text-2xl font-bold text-slate-50">Integración con Jira</h1>
        <p className="mt-1 text-sm text-slate-400">
          Conectá tu instancia de Jira Cloud para crear bugs directamente desde los
          tests que fallan en un reporte. El API token se guarda cifrado (AES-256-GCM).
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Generá un API token en{' '}
          <a
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 hover:underline"
          >
            id.atlassian.com/manage-profile/security/api-tokens
          </a>
        </p>
      </header>

      <form
        onSubmit={handleSave}
        className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs uppercase tracking-widest text-slate-500">
              URL de Jira
            </span>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://tu-org.atlassian.net"
              required
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-slate-500">
              Email de la cuenta
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@empresa.com"
              required
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-slate-500">
              API token
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hint ? `actual: ${hint} — dejá vacío para conservar` : 'pegá el token'}
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-slate-500">
              Proyecto default
            </span>
            {projects.length > 0 ? (
              <select
                value={defaultProjectKey}
                onChange={(e) => setDefaultProjectKey(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">(elegir al crear el bug)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.key}>
                    {p.key} — {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={defaultProjectKey}
                onChange={(e) => setDefaultProjectKey(e.target.value.toUpperCase())}
                placeholder="ej: QA"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            )}
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-slate-500">
              Tipo de issue
            </span>
            <input
              type="text"
              value={defaultIssueType}
              onChange={(e) => setDefaultIssueType(e.target.value)}
              placeholder="Bug"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
        </div>

        {error ? (
          <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {notice}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving || !baseUrl.trim() || !email.trim()}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar configuración'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !baseUrl.trim() || !email.trim() || (!configured && !token.trim())}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          {configured ? (
            <button
              type="button"
              onClick={handleDelete}
              className="ml-auto rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
            >
              Borrar configuración
            </button>
          ) : null}
        </div>
      </form>

      {configured ? (
        <p className="mt-4 text-xs text-slate-500">
          ✓ Jira configurado. Abrí cualquier reporte y usá el botón{' '}
          <span className="text-slate-300">“Crear bug”</span> en los tests con FAIL o WARNING.
        </p>
      ) : null}
    </section>
  );
}
