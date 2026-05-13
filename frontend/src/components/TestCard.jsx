// Tarjeta que renderiza un Result individual.

const STATUS_STYLES = {
  pass: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300',
  fail: 'border-red-500/40 bg-red-500/5 text-red-300',
  warning: 'border-amber-500/40 bg-amber-500/5 text-amber-300',
  info: 'border-blue-500/40 bg-blue-500/5 text-blue-300',
};

export function TestCard({ result }) {
  const tone = STATUS_STYLES[result.status] ?? STATUS_STYLES.info;
  return (
    <li
      className={`rounded-lg border px-4 py-3 ${tone}`}
      data-testid={`test-card-${result.testName}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-widest opacity-70">{result.category}</p>
          <p className="font-medium text-slate-100">{result.testName}</p>
        </div>
        <span className="text-xs font-semibold uppercase tracking-widest">
          {result.status}
          {typeof result.score === 'number' ? ` · ${result.score}` : ''}
        </span>
      </div>

      {result.details ? <DetailsPreview details={result.details} /> : null}
    </li>
  );
}

function DetailsPreview({ details }) {
  if (details?.error) {
    return (
      <p className="mt-2 text-sm text-red-200/80">
        <span className="font-semibold">Error:</span> {String(details.error)}
      </p>
    );
  }

  const summaryLines = [];
  if (details?.httpStatus) summaryLines.push(`HTTP ${details.httpStatus}`);
  if (details?.title) summaryLines.push(`Title: ${details.title}`);
  if (details?.daysRemaining != null)
    summaryLines.push(`SSL: ${details.daysRemaining} días restantes`);
  if (details?.securityHeaders?.missing?.length != null)
    summaryLines.push(
      `Headers faltantes: ${details.securityHeaders.missing.length} / críticos: ${details.securityHeaders.missingCritical?.length ?? 0}`,
    );
  if (Array.isArray(details?.links)) summaryLines.push(`Links: ${details.links.length}`);
  if (Array.isArray(details?.forms)) summaryLines.push(`Forms: ${details.forms.length}`);

  if (summaryLines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-slate-300/80">
      {summaryLines.map((line) => (
        <li key={line}>· {line}</li>
      ))}
    </ul>
  );
}
