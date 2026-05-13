// Barra de progreso del scan basada en el stage actual.

const STAGES = [
  { key: 'queued', label: 'En cola' },
  { key: 'launching_browser', label: 'Browser' },
  { key: 'capturing_dom', label: 'DOM' },
  { key: 'analyzing_headers', label: 'Headers' },
  { key: 'analyzing_ssl', label: 'SSL' },
  { key: 'completed', label: 'Listo' },
];

export function ScanProgress({ status, stage, message, errorMessage }) {
  const activeIndex = STAGES.findIndex((s) => s.key === stage);
  const isDone = status === 'completed';
  const isFailed = status === 'failed';

  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 px-5 py-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-widest text-slate-500">
        <span>Progreso</span>
        <span>{stage ?? '—'}</span>
      </div>

      <div className="mt-3 flex gap-1.5" aria-label="progress-bar">
        {STAGES.map((s, idx) => {
          const reached = isDone || (activeIndex >= 0 && idx <= activeIndex);
          const isActive = idx === activeIndex && !isDone;
          return (
            <div
              key={s.key}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                isFailed
                  ? 'bg-red-500/40'
                  : reached
                    ? 'bg-emerald-400'
                    : 'bg-slate-700'
              } ${isActive ? 'animate-pulse' : ''}`}
              title={s.label}
            />
          );
        })}
      </div>

      <p
        className={`mt-3 text-sm ${isFailed ? 'text-red-300' : 'text-slate-300'}`}
        data-testid="scan-progress-message"
      >
        {isFailed ? (errorMessage ?? 'Scan falló') : (message ?? 'Esperando…')}
      </p>
    </div>
  );
}
