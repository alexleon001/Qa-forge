// Login con email + password.

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { loginUser } from '../lib/api.js';
import { useAuthStore } from '../store/auth.store.js';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = location.state?.from ?? '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user, token } = await loginUser({ email, password });
      setSession({ user, token });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto flex max-w-md flex-col items-center px-6 py-16">
      <h1 className="text-2xl font-bold text-slate-50">Iniciar sesión</h1>
      <p className="mt-1 text-sm text-slate-500">Accedé a tus scans y API keys.</p>

      <form
        onSubmit={handleSubmit}
        className="mt-8 w-full space-y-4 rounded-xl border border-slate-800/70 bg-slate-900/40 p-6"
      >
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />
        {error ? (
          <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="login-submit"
        >
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-400">
        ¿Sin cuenta?{' '}
        <Link to="/register" className="text-emerald-400 hover:underline">
          Registrate
        </Link>
      </p>
    </section>
  );
}

function Field({ label, type, value, onChange, autoComplete, required }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-widest text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </label>
  );
}
