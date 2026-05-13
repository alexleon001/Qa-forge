// Gauge SVG simple: muestra un score 0-100 con color por umbral.

export function ScoreGauge({ score, label, size = 96 }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : null;
  const offset = clamped == null ? circumference : circumference * (1 - clamped / 100);
  const stroke = clamped == null ? '#475569' : colorForScore(clamped);
  const text = clamped == null ? '—' : String(clamped);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90" aria-label={`gauge-${label}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#1e293b"
          strokeWidth="8"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms ease, stroke 300ms ease' }}
        />
        <text
          x={size / 2}
          y={size / 2}
          dy="0.35em"
          textAnchor="middle"
          fill="#f1f5f9"
          fontSize={size * 0.28}
          fontWeight="700"
          className="rotate-90"
          transform={`rotate(90 ${size / 2} ${size / 2})`}
        >
          {text}
        </text>
      </svg>
      {label ? (
        <span className="text-xs uppercase tracking-widest text-slate-500">{label}</span>
      ) : null}
    </div>
  );
}

function colorForScore(score) {
  if (score >= 85) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}
