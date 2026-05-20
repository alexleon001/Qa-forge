// Layout raíz + ruteo de QA Forge.

import { Link, Route, Routes, useNavigate } from 'react-router-dom';

import { ApiKeys } from './views/ApiKeys.jsx';
import { Compare } from './views/Compare.jsx';
import { Dashboard } from './views/Dashboard.jsx';
import { History } from './views/History.jsx';
import { Home } from './views/Home.jsx';
import { JiraSettings } from './views/JiraSettings.jsx';
import { Login } from './views/Login.jsx';
import { ManualCases } from './views/ManualCases.jsx';
import { Register } from './views/Register.jsx';
import { ReportDetail } from './views/ReportDetail.jsx';
import { RequireAuth } from './components/RequireAuth.jsx';
import { Schedules } from './views/Schedules.jsx';
import { ScriptGenerator } from './views/ScriptGenerator.jsx';
import { useAuthStore } from './store/auth.store.js';

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800/60 bg-slate-950/60 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-slate-100">
            <span className="text-xl font-bold tracking-tight">
              <span className="text-emerald-400">QA</span> Forge
            </span>
            <span className="text-xs uppercase tracking-widest text-slate-500">
              automated qa
            </span>
          </Link>
          <NavBar />
        </div>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          <Route
            path="/scan/:scanId"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/scan/:scanId/report"
            element={
              <RequireAuth>
                <ReportDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/scan/:scanId/scripts"
            element={
              <RequireAuth>
                <ScriptGenerator />
              </RequireAuth>
            }
          />
          <Route
            path="/scan/:scanId/manual-cases"
            element={
              <RequireAuth>
                <ManualCases />
              </RequireAuth>
            }
          />
          <Route
            path="/history"
            element={
              <RequireAuth>
                <History />
              </RequireAuth>
            }
          />
          <Route
            path="/compare"
            element={
              <RequireAuth>
                <Compare />
              </RequireAuth>
            }
          />
          <Route
            path="/settings/api-keys"
            element={
              <RequireAuth>
                <ApiKeys />
              </RequireAuth>
            }
          />
          <Route
            path="/settings/jira"
            element={
              <RequireAuth>
                <JiraSettings />
              </RequireAuth>
            }
          />
          <Route
            path="/schedules"
            element={
              <RequireAuth>
                <Schedules />
              </RequireAuth>
            }
          />
        </Routes>
      </main>

      <footer className="border-t border-slate-800/60 bg-slate-950/40">
        <div className="mx-auto max-w-6xl px-6 py-3 text-xs text-slate-500">
          QA Forge · v0.1 · Playwright + Claude API
        </div>
      </footer>
    </div>
  );
}

function NavBar() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  if (!user) {
    return (
      <nav className="flex items-center gap-4 text-sm text-slate-400">
        <Link to="/login" className="hover:text-slate-100">Iniciar sesión</Link>
        <Link
          to="/register"
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-emerald-400"
        >
          Registrarse
        </Link>
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-4 text-sm text-slate-400">
      <Link to="/" className="hover:text-slate-100">Home</Link>
      <span className="opacity-30">·</span>
      <Link to="/history" className="hover:text-slate-100">History</Link>
      <span className="opacity-30">·</span>
      <Link to="/schedules" className="hover:text-slate-100">Schedules</Link>
      <span className="opacity-30">·</span>
      <Link to="/settings/api-keys" className="hover:text-slate-100">API Keys</Link>
      <span className="opacity-30">·</span>
      <Link to="/settings/jira" className="hover:text-slate-100">Jira</Link>
      <span className="opacity-30">·</span>
      <span className="text-xs text-slate-500" title={user.email}>
        {user.name || user.email}
      </span>
      <button
        type="button"
        onClick={() => {
          logout();
          navigate('/login');
        }}
        className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-red-500/40 hover:text-red-300"
      >
        Salir
      </button>
    </nav>
  );
}
