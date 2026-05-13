// Genera un HTML self-contained con el reporte de un scan.
// Incluye estilos inline para que el archivo descargado se vea bien sin red.

const STATUS_COLOR = {
  pass: '#10b981',
  fail: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

const CATEGORY_LABEL = {
  functional: 'Funcional',
  security: 'Seguridad',
  performance: 'Performance',
  accessibility: 'Accesibilidad',
  seo: 'SEO',
};

export function renderReportHtml(report) {
  const { scan, totals, scoreByCategory, byCategory } = report;

  const categoriesHtml = Object.entries(byCategory)
    .filter(([, results]) => results.length > 0)
    .map(([cat, results]) => renderCategoryBlock(cat, results, scoreByCategory[cat]))
    .join('\n');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>QA Forge Report — ${escapeHtml(scan.url)}</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 0; padding: 32px; background: #020617; color: #e2e8f0; line-height: 1.5; }
  .container { max-width: 960px; margin: 0 auto; }
  header { border-bottom: 1px solid #1e293b; padding-bottom: 20px; margin-bottom: 24px; }
  h1 { font-size: 28px; margin: 0 0 4px; color: #f1f5f9; }
  h2 { font-size: 18px; margin: 32px 0 12px; color: #f1f5f9; text-transform: uppercase; letter-spacing: 0.08em; }
  .meta { color: #94a3b8; font-size: 14px; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }
  .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
  .tile { background: rgba(15,23,42,0.6); border: 1px solid #1e293b; border-radius: 10px; padding: 14px; }
  .tile .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; }
  .tile .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
  .scores { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 16px 0 24px; }
  .scores .tile .value { font-size: 22px; }
  .test { background: rgba(15,23,42,0.5); border: 1px solid #1e293b; border-left-width: 4px; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; }
  .test .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .test .name { font-weight: 600; color: #f1f5f9; }
  .test .cat { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; }
  pre { background: #0b1220; border: 1px solid #1e293b; border-radius: 8px; padding: 10px; overflow: auto; font-size: 12px; color: #cbd5e1; max-height: 280px; }
  footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #1e293b; color: #64748b; font-size: 12px; }
  a { color: #34d399; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>QA Forge Report</h1>
    <div class="meta">
      <a href="${escapeHtml(scan.url)}" target="_blank">${escapeHtml(scan.url)}</a><br/>
      Scan ID: <code>${escapeHtml(scan.id)}</code> · Status:
      <span class="pill" style="background:${pillBg(scan.status)};color:${pillFg(scan.status)}">${escapeHtml(scan.status)}</span><br/>
      Generado: ${escapeHtml(new Date().toISOString())}
    </div>
  </header>

  <section>
    <h2>Resumen</h2>
    <div class="totals">
      <div class="tile"><div class="label">Total</div><div class="value">${totals.total}</div></div>
      <div class="tile"><div class="label" style="color:${STATUS_COLOR.pass}">Pass</div><div class="value" style="color:${STATUS_COLOR.pass}">${totals.pass}</div></div>
      <div class="tile"><div class="label" style="color:${STATUS_COLOR.fail}">Fail</div><div class="value" style="color:${STATUS_COLOR.fail}">${totals.fail}</div></div>
      <div class="tile"><div class="label" style="color:${STATUS_COLOR.warning}">Warning</div><div class="value" style="color:${STATUS_COLOR.warning}">${totals.warning}</div></div>
    </div>
  </section>

  ${Object.keys(scoreByCategory).length > 0 ? renderScoresBlock(scoreByCategory) : ''}

  ${categoriesHtml}

  <footer>
    QA Forge · Reporte generado el ${new Date().toLocaleString('es-ES')}
  </footer>
</div>
</body>
</html>`;
}

function renderScoresBlock(scoreByCategory) {
  const tiles = Object.entries(scoreByCategory)
    .map(
      ([cat, score]) => `
      <div class="tile">
        <div class="label">${escapeHtml(CATEGORY_LABEL[cat] || cat)}</div>
        <div class="value" style="color:${scoreColor(score)}">${score}</div>
      </div>`,
    )
    .join('');
  return `<section><h2>Scores</h2><div class="scores">${tiles}</div></section>`;
}

function renderCategoryBlock(cat, results, avgScore) {
  const blocks = results.map((r) => {
    const color = STATUS_COLOR[r.status] || '#64748b';
    const detailsJson = safeJson(r.details);
    return `
      <div class="test" style="border-left-color:${color}">
        <div class="head">
          <div>
            <div class="cat">${escapeHtml(CATEGORY_LABEL[cat] || cat)}</div>
            <div class="name">${escapeHtml(r.testName)}</div>
          </div>
          <div>
            <span class="pill" style="background:${color}22;color:${color};border:1px solid ${color}66">
              ${escapeHtml(r.status)}${typeof r.score === 'number' ? ' · ' + r.score : ''}
            </span>
          </div>
        </div>
        ${detailsJson ? `<pre>${escapeHtml(detailsJson)}</pre>` : ''}
      </div>`;
  }).join('');
  const header = `<h2>${escapeHtml(CATEGORY_LABEL[cat] || cat)}${typeof avgScore === 'number' ? ` · score ${avgScore}` : ''}</h2>`;
  return `<section>${header}${blocks}</section>`;
}

function pillBg(status) {
  const map = {
    completed: '#10b98122',
    failed: '#ef444422',
    running: '#3b82f622',
    pending: '#64748b22',
  };
  return map[status] || '#64748b22';
}

function pillFg(status) {
  const map = {
    completed: '#34d399',
    failed: '#f87171',
    running: '#60a5fa',
    pending: '#94a3b8',
  };
  return map[status] || '#94a3b8';
}

function scoreColor(score) {
  if (score >= 85) return STATUS_COLOR.pass;
  if (score >= 60) return STATUS_COLOR.warning;
  return STATUS_COLOR.fail;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  if (value == null) return null;
  // Recortamos screenshots base64 y html crudo para que el reporte no pese.
  const cleaned = trimHeavyFields(value);
  try {
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return String(value);
  }
}

function trimHeavyFields(obj, depth = 0) {
  if (depth > 6 || obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 50).map((v) => trimHeavyFields(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'html' && typeof v === 'string') out[k] = `[${v.length} chars omitidos]`;
    else if (k === 'screenshot' && typeof v === 'string') out[k] = `[base64 ${v.length} chars omitidos]`;
    else if (k === 'headersAll' && typeof v === 'object') out[k] = Object.keys(v).slice(0, 20);
    else out[k] = trimHeavyFields(v, depth + 1);
  }
  return out;
}
