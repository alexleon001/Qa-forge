// Repository — lista de SUTs (software bajo prueba) del repositorio de casos
// de prueba manuales (FASE 10). Repositorio compartido por todo el equipo.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { createSut, deleteSut, listSuts } from '../lib/api.js';

const INPUT =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export function Repository() {
  const [suts, setSuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', baseUrl: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listSuts()
      .then((data) => {
        if (!cancelled) setSuts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message ?? err?.message ?? 'Error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const sut = await createSut({
        name: form.name.trim(),
        description: form.description.trim() || null,
        baseUrl: form.baseUrl.trim() || null,
      });
      setSuts((prev) => [{ ...sut, caseCount: 0 }, ...prev]);
      setForm({ name: '', description: '', baseUrl: '' });
      setShowForm(false);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo crear el SUT');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (sut) => {
    if (!window.confirm(`¿Borrar "${sut.name}" y sus ${sut.caseCount} casos? No se puede deshacer.`)) {
      return;
    }
    setSuts((prev) => prev.filter((s) => s.id !== sut.id));
    try {
      await deleteSut(sut.id);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudo borrar');
    }
  };

  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">test case repository</p>
          <h1 className="text-2xl font-bold text-slate-50">Repositorio de casos de prueba</h1>
          <p className="mt-1 text-xs text-slate-500">
            Casos de prueba manuales organizados por software bajo prueba. Compartido con el equipo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
        >
          {showForm ? 'Cerrar' : '+ Nuevo SUT'}
        </button>
      </header>

      {showForm ? (
        <form
          onSubmit={handleCreate}
          className="mb-6 space-y-3 rounded-xl border border-emerald-500/30 bg-slate-900/60 p-5"
        >
          <div>
            <label className="block text-xs uppercase tracking-widest text-slate-500">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              maxLength={160}
              placeholder="Ej: Tienda online ACME"
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-slate-500">
              Descripción
            </label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-slate-500">
              URL principal (opcional)
            </label>
            <input
              type="text"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder="https://…"
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <button
            type="submit"
            disabled={creating || !form.name.trim()}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {creating ? 'Creando…' : 'Crear SUT'}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : suts.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-8 text-center text-sm text-slate-400">
          Todavía no hay ningún software bajo prueba. Creá el primero con <em>+ Nuevo SUT</em>.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {suts.map((sut) => (
            <div
              key={sut.id}
              className="flex flex-col rounded-xl border border-slate-800/70 bg-slate-900/40 p-5 hover:border-emerald-500/40"
            >
              <div className="flex items-start justify-between gap-3">
                <Link to={`/repository/${sut.id}`} className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-slate-100 hover:text-emerald-300">
                    {sut.name}
                  </h2>
                </Link>
                <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-emerald-300">
                  {sut.caseCount} {sut.caseCount === 1 ? 'caso' : 'casos'}
                </span>
              </div>
              {sut.description ? (
                <p className="mt-1 line-clamp-2 text-xs text-slate-400">{sut.description}</p>
              ) : null}
              {sut.baseUrl ? (
                <p className="mt-1 truncate text-xs text-slate-600">{sut.baseUrl}</p>
              ) : null}
              <div className="mt-4 flex items-center justify-between">
                <Link
                  to={`/repository/${sut.id}`}
                  className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10"
                >
                  Abrir →
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(sut)}
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-500 hover:border-red-500/60 hover:text-red-300"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
