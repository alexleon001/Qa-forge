// Gestión de API keys del usuario. Las keys se cifran en el backend y solo
// se muestra un "hint" (primeros 4 + últimos 4 chars).

import { useEffect, useState } from 'react';

import {
  createUserApiKey,
  deleteUserApiKey,
  listUserApiKeys,
  setUserApiKeyDefault,
} from '../lib/api.js';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI (ChatGPT)', help: 'platform.openai.com/api-keys' },
  { id: 'opencode', label: 'opencode Zen', help: 'opencode.ai/zen → Claves API' },
  { id: 'anthropic', label: 'Anthropic Claude', help: 'console.anthropic.com' },
  { id: 'gemini', label: 'Google Gemini', help: 'aistudio.google.com/apikey' },
  { id: 'openrouter', label: 'OpenRouter', help: 'openrouter.ai/keys' },
];

export function ApiKeys() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Form state
  const [provider, setProvider] = useState('openai');
  const [keyValue, setKeyValue] = useState('');
  const [label, setLabel] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listUserApiKeys();
      setKeys(data);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Error cargando keys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await createUserApiKey({
        provider,
        key: keyValue.trim(),
        label: label.trim() || null,
        isDefault,
      });
      setKeyValue('');
      setLabel('');
      await reload();
    } catch (err) {
      setFormError(err?.response?.data?.message ?? err?.message ?? 'No se pudo guardar la key');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Borrar esta API key?')) return;
    try {
      await deleteUserApiKey(id);
      await reload();
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Error al borrar');
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await setUserApiKeyDefault(id);
      await reload();
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Error al marcar default');
    }
  };

  const providerMeta = PROVIDERS.find((p) => p.id === provider);

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-slate-500">settings</p>
        <h1 className="text-2xl font-bold text-slate-50">API Keys de IA</h1>
        <p className="mt-1 text-sm text-slate-400">
          Tus keys se guardan cifradas (AES-256-GCM). Solo se muestran los primeros y
          últimos 4 caracteres. Cada provider puede tener varias keys; marcá una como default.
        </p>
      </header>

      <form
        onSubmit={handleAdd}
        className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-5"
      >
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-300">
          Agregar nueva key
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-slate-500">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {providerMeta?.help ? (
              <span className="mt-1 block text-xs text-slate-500">
                Conseguila en {providerMeta.help}
              </span>
            ) : null}
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-slate-500">
              Label (opcional)
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ej: Cuenta personal"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
        </div>
        <label className="mt-4 block">
          <span className="text-xs uppercase tracking-widest text-slate-500">API key</span>
          <input
            type="password"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder="sk-..."
            required
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
          />
          Usar como key default para este provider
        </label>
        {formError ? (
          <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {formError}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || !keyValue.trim()}
          className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="add-key-btn"
        >
          {submitting ? 'Guardando…' : 'Guardar key'}
        </button>
      </form>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-300">
          Keys guardadas ({keys.length})
        </h2>
        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : error ? (
          <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : keys.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-500">
            Todavía no tenés keys cargadas. Agregá la primera arriba.
          </p>
        ) : (
          <ul className="space-y-2">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300">
                    {k.provider}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {k.label || '(sin label)'}
                    </p>
                    <p className="font-mono text-xs text-slate-500">{k.hint}</p>
                  </div>
                  {k.isDefault ? (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-emerald-300">
                      default
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {!k.isDefault ? (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(k.id)}
                      className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                    >
                      Marcar default
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleDelete(k.id)}
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
