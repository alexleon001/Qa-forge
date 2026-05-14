// Genera un reporte JUnit XML estándar a partir del payload de loadReport().
// El formato es el de surefire/jest, parseado nativamente por GitHub Actions,
// GitLab CI, Jenkins (publish JUnit), CircleCI, Bitbucket Pipelines, etc.
//
// Mapeo:
//   - Un <testsuites> con resumen agregado
//   - Un <testsuite> por categoría (functional, security, performance, ...)
//   - Un <testcase> por Result
//   - status=fail   → <failure>
//   - status=warning → <failure type="warning"> (CI igual lo marca rojo, esto
//     es opinable — algunos prefieren <skipped>. Default: fail, configurable
//     via env JUNIT_TREAT_WARNINGS=skipped si en el futuro se necesita)

const TREAT_WARNINGS_AS_SKIPPED =
  String(process.env.JUNIT_TREAT_WARNINGS || '').toLowerCase() === 'skipped';

/**
 * @param {object} report — output de loadReport()
 * @returns {string} XML serializado, UTF-8
 */
export function renderReportJunit(report) {
  const { scan, totals, byCategory } = report;
  const timestamp = (scan.completedAt ?? scan.startedAt ?? scan.createdAt ?? new Date())
    .toString();
  // Tiempo total del scan en segundos (si tenemos startedAt/completedAt)
  const totalTimeSec = computeDurationSec(scan.startedAt, scan.completedAt);

  const suites = Object.entries(byCategory)
    .filter(([, results]) => results.length > 0)
    .map(([cat, results]) => renderSuite(cat, results, scan, timestamp))
    .join('\n');

  const skipped = TREAT_WARNINGS_AS_SKIPPED ? totals.warning : 0;
  const failures = totals.fail + (TREAT_WARNINGS_AS_SKIPPED ? 0 : totals.warning);

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="QA Forge" tests="${totals.total}" failures="${failures}" errors="0" skipped="${skipped}" time="${totalTimeSec.toFixed(3)}">
${suites}
</testsuites>
`;
}

function renderSuite(category, results, scan, timestamp) {
  const failures = results.filter((r) => r.status === 'fail').length;
  const warnings = results.filter((r) => r.status === 'warning').length;
  const skipped = TREAT_WARNINGS_AS_SKIPPED ? warnings : 0;
  const failureCount = failures + (TREAT_WARNINGS_AS_SKIPPED ? 0 : warnings);

  const cases = results.map((r) => renderCase(r, category)).join('\n');
  void scan;

  return `  <testsuite name="${xmlAttr(category)}" tests="${results.length}" failures="${failureCount}" errors="0" skipped="${skipped}" hostname="${xmlAttr(safeHost(scan.url))}" timestamp="${xmlAttr(toIso(timestamp))}">
${cases}
  </testsuite>`;
}

function renderCase(result, category) {
  // El testName a menudo ya incluye el prefijo de categoría (ej. "security.score").
  // Lo deduplicamos para no producir "security.security.score".
  const testName = String(result.testName ?? '');
  const name = testName.startsWith(`${category}.`)
    ? testName
    : `${category}.${testName}`;
  const className = `qa-forge.${category}`;
  const time = '0.000'; // No medimos duración per-test todavía — placeholder

  if (result.status === 'pass' || result.status === 'info') {
    return `    <testcase classname="${xmlAttr(className)}" name="${xmlAttr(name)}" time="${time}"/>`;
  }

  if (result.status === 'warning' && TREAT_WARNINGS_AS_SKIPPED) {
    const reason = extractMessage(result) || 'warning';
    return `    <testcase classname="${xmlAttr(className)}" name="${xmlAttr(name)}" time="${time}">
      <skipped message="${xmlAttr(reason)}"/>
    </testcase>`;
  }

  // fail o warning treated as failure
  const type = result.status === 'warning' ? 'warning' : 'failure';
  const message = extractMessage(result) || result.status;
  const body = describeFailure(result);
  return `    <testcase classname="${xmlAttr(className)}" name="${xmlAttr(name)}" time="${time}">
      <failure message="${xmlAttr(message)}" type="${type}"><![CDATA[
${body}
      ]]></failure>
    </testcase>`;
}

function extractMessage(result) {
  const d = result.details || {};
  if (d.error) return String(d.error).slice(0, 240);
  if (typeof d.message === 'string') return d.message.slice(0, 240);
  if (typeof d.score === 'number') return `score=${d.score}`;
  return '';
}

function describeFailure(result) {
  // Compactamos details para el CDATA: violaciones de axe, links rotos, headers
  // faltantes, etc. — todo lo que ayude a entender el fail desde la UI del CI.
  const lines = [`status=${result.status}`];
  if (typeof result.score === 'number') lines.push(`score=${result.score}`);
  const d = result.details || {};
  if (d.error) lines.push(`error: ${truncate(String(d.error), 800)}`);
  if (Array.isArray(d.violations)) {
    lines.push(`violations=${d.violations.length}`);
    for (const v of d.violations.slice(0, 5)) {
      lines.push(`  - [${v.impact}] ${v.id}: ${truncate(v.help || '', 120)}`);
    }
  }
  if (Array.isArray(d.brokenLinks) && d.brokenLinks.length > 0) {
    lines.push(`broken links=${d.brokenLinks.length}`);
    for (const b of d.brokenLinks.slice(0, 5)) {
      lines.push(`  - ${b.url || b} ${b.status ? `(${b.status})` : ''}`);
    }
  }
  if (Array.isArray(d.missing) && d.missing.length > 0) {
    lines.push(`missing: ${d.missing.join(', ')}`);
  }
  if (Array.isArray(d.findings) && d.findings.length > 0) {
    for (const f of d.findings.slice(0, 5)) {
      lines.push(`  - ${typeof f === 'string' ? f : JSON.stringify(f).slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}

function computeDurationSec(startedAt, completedAt) {
  if (!startedAt || !completedAt) return 0;
  const a = new Date(startedAt).getTime();
  const b = new Date(completedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, (b - a) / 1000);
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function toIso(t) {
  try {
    return new Date(t).toISOString();
  } catch {
    return '';
  }
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function xmlAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
