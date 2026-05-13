// Registro de nuevo usuario.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { registerUser } from '../lib/api.js';
import { useAuthStore } from '../store/auth.store.js';

export function Register() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Las passwords no coinciden');
      return;
    }
    setSubmitting(true);
    try {
      const { user, token } = await registerUser({
        email,
        password,
        name: name.trim() || null,
      });
      setSession({ user, token });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo registrar');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto flex max-w-md flex-col items-center px-6 py-16">
      <h1 className="text-2xl font-bold text-slate-50">Crear cuenta</h1>
      <p className="mt-1 text-sm text-slate-500">
        El primer usuario es admin. Después podés invitar a tu equipo.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-8 w-full space-y-4 rounded-xl border border-slate-800/70 bg-slate-900/40 p-6"
      >
        <Field label="Nombre (opcional)" value={name} onChange={setName} autoComplete="name" />
        <Field label="Email" type="email" value={email} onChange={setEmail} required autoComplete="email" />
        <Field
          label="Password (mín. 8 caracteres)"
          type="password"
          value={password}
          onChange={setPassword}
          required
          autoComplete="new-password"
        />
        <Field
          label="Repetir password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          required
          autoComplete="new-password"
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
          data-testid="register-submit"
        >
          {submitting ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-400">
        ¿Ya tenés cuenta?{' '}
        <Link to="/login" className="text-emerald-400 hover:underline">
          Iniciar sesión
        </Link>
      </p>
    </section>
  );
}

function Field({ label, type = 'text', value, onChange, autoComplete, required }) {
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
