// NativeProviders — config de endpoints Appium para el Native app testing (#15).
// Soporta Appium local (gratis) y device clouds BrowserStack / Sauce Labs (pagos).
// El accessKey del cloud se cifra en el backend; acá solo se muestra el hint.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { NATIVE_PROVIDER_TYPES } from '@shared/constants.js';
import {
  createNativeProvider,
  deleteNativeProvider,
  listNativeProviders,
  testNativeProvider,
} from '../lib/api.js';

const TYPES = Object.values(NATIVE_PROVIDER_TYPES);

export function NativeProviders() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState('local');
  const [label, setLabel] = useState('');
  const [appiumUrl, setAppiumUrl] = useState('');
  const [username, setUsername] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState({}); // { [id]: { ok, message } }

  const reload = () => {
    setLoading(true);
    listNativeProviders()
      .then(setProviders)
      .catch(() => setProviders([]))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const isCloud = type !== 'local';
  const meta = NATIVE_PROVIDER_TYPES[type];

  const create = async () => {
    setError(null);
    setSaving(true);
    try {
      await createNativeProvider({
        type,
        label: label.trim() || meta.label,
        appiumUrl: appiumUrl.trim() || null,
        username: isCloud ? username.trim() : null,
        accessKey: isCloud ? accessKey.trim() : null,
        region: type === 'saucelabs' ? region.trim() || null : null,
      });
      setLabel('');
      setAppiumUrl('');
      setUsername('');
      setAccessKey('');
      setRegion('');
      reload();
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo crear');
    } finally {
      setSaving(false);
    }
  };

  const test = async (id) => {
    setTestResult((r) => ({ ...r, [id]: { testing: true } }));
    try {
      const res = await testNativeProvider(id);
      setTestResult((r) => ({ ...r, [id]: { ok: true, message: `Conectado · ${res.status?.build?.version ? `Appium ${res.status.build.version}` : 'OK'}` } }));
    } catch (err) {
      setTestResult((r) => ({ ...r, [id]: { ok: false, message: err?.response?.data?.message ?? err?.message ?? 'Falló' } }));
    }
  };

  const remove = async (id) => {
    if (!confirm('¿Borrar este provider? Los flujos que lo usan también se borran.')) return;
    await deleteNativeProvider(id).catch(() => {});
    reload();
  };

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-slate-500">native app testing · endpoints</p>
        <h1 className="text-2xl font-bold text-slate-50">Providers Appium</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configurá dónde corren tus tests native: un servidor <strong>Appium local</strong> (gratis,
          en tu máquina) o un <strong>device cloud</strong> (BrowserStack / Sauce Labs, pagos).
          Después creás flujos en <Link to="/native" className="text-emerald-300 hover:underline">Native</Link>.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-slate-800/70 bg-slate-900/40 p-5">
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setType(t.id)}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                type === t.id ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'
              }`}
            >
              {t.label} {t.paid ? '💲' : '🆓'}
            </button>
          ))}
        </div>

        <Field label="Nombre" value={label} onChange={setLabel} placeholder={meta.label} />
        <Field
          label={isCloud ? 'Hub URL (opcional, default del cloud)' : 'Appium URL'}
          value={appiumUrl}
          onChange={setAppiumUrl}
          placeholder={meta.defaultUrl}
        />
        {isCloud ? (
          <>
            <Field label="Username" value={username} onChange={setUsername} placeholder="tu usuario del cloud" />
            <Field label="Access Key" value={accessKey} onChange={setAccessKey} placeholder="se cifra en el servidor" type="password" />
            {type === 'saucelabs' ? (
              <Field label="Región (ej: us-west-1, eu-central-1)" value={region} onChange={setRegion} placeholder="us-west-1" />
            ) : null}
          </>
        ) : null}

        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button
          type="button"
          disabled={saving}
          onClick={create}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
        >
          {saving ? '…' : 'Agregar provider'}
        </button>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-300">Configurados ({providers.length})</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-slate-500">Sin providers todavía.</p>
        ) : (
          <ul className="space-y-2">
            {providers.map((p) => {
              const tr = testResult[p.id];
              return (
                <li key={p.id} className="rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-slate-100">{p.label}</span>
                      <span className="ml-2 text-slate-500">{NATIVE_PROVIDER_TYPES[p.type]?.label ?? p.type}</span>
                      {p.appiumUrl ? <span className="ml-2 font-mono text-slate-600">{p.appiumUrl}</span> : null}
                      {p.hasAccessKey ? <span className="ml-2 text-slate-600">🔑 {p.hint}</span> : null}
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => test(p.id)} className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300">
                        {tr?.testing ? '…' : 'Probar'}
                      </button>
                      <button type="button" onClick={() => remove(p.id)} className="rounded border border-red-500/40 px-2 py-1 text-red-300 hover:bg-red-500/10">
                        Borrar
                      </button>
                    </div>
                  </div>
                  {tr && !tr.testing ? (
                    <p className={`mt-2 ${tr.ok ? 'text-emerald-300' : 'text-red-300'}`}>{tr.ok ? '✓ ' : '✗ '}{tr.message}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </label>
  );
}
