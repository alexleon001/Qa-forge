// Layout raíz + ruteo de QA Forge.

import { Link, Route, Routes } from 'react-router-dom';

import { Compare } from './views/Compare.jsx';
import { Dashboard } from './views/Dashboard.jsx';
import { History } from './views/History.jsx';
import { Home } from './views/Home.jsx';
import { ManualCases } from './views/ManualCases.jsx';
import { ReportDetail } from './views/ReportDetail.jsx';
import { ScriptGenerator } from './views/ScriptGenerator.jsx';

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
          <nav className="flex items-center gap-4 text-sm text-slate-400">
            <Link to="/" className="hover:text-slate-100">Home</Link>
            <span className="opacity-30">·</span>
            <Link to="/history" className="hover:text-slate-100">History</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/scan/:scanId" element={<Dashboard />} />
          <Route path="/scan/:scanId/report" element={<ReportDetail />} />
          <Route path="/scan/:scanId/scripts" element={<ScriptGenerator />} />
          <Route path="/scan/:scanId/manual-cases" element={<ManualCases />} />
          <Route path="/history" element={<History />} />
          <Route path="/compare" element={<Compare />} />
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
