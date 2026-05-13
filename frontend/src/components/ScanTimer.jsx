// Timer del scan — muestra elapsed mientras corre, total cuando termina.

import { useEffect, useState } from 'react';

export function ScanTimer({ startedAt, endedAt, status }) {
  const [now, setNow] = useState(() => Date.now());
  const live = !endedAt && status === 'running';

  useEffect(() => {
    if (!live) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [live]);

  if (!startedAt) {
    return (
      <span className="font-mono text-sm text-slate-500" data-testid="scan-timer">
        --:--
      </span>
    );
  }

  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : now;
  const elapsed = Math.max(0, end - start);

  return (
    <span
      className={`font-mono text-sm ${live ? 'text-emerald-300' : 'text-slate-300'}`}
      data-testid="scan-timer"
      title={live ? 'Tiempo transcurrido' : 'Tiempo total del scan'}
    >
      {formatDuration(elapsed)}
    </span>
  );
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
