// FASE 8.10: arma el contenido de un bug de Jira a partir de un Result de un
// scan. Produce summary + descripción ADF lista para createIssue().

import {
  adfBulletList,
  adfDoc,
  adfHeading,
  adfParagraph,
  adfText,
} from './jira.client.js';

/** Hostname legible de una URL, o la URL cruda si no parsea. */
function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url ?? '');
  }
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Extrae viñetas de hallazgos desde `result.details`. Cubre los shapes que
 * producen los runners/analyzers: error, violaciones de axe, links rotos,
 * headers de seguridad faltantes, mismatch visual, findings genéricos.
 */
export function summarizeFindings(result) {
  const lines = [];
  const d = result?.details || {};

  if (d.error) lines.push(`Error: ${truncate(d.error, 300)}`);
  if (typeof d.message === 'string' && d.message) lines.push(truncate(d.message, 300));

  if (Array.isArray(d.violations) && d.violations.length > 0) {
    lines.push(`Violaciones de accesibilidad: ${d.violations.length}`);
    for (const v of d.violations.slice(0, 8)) {
      lines.push(`[${v.impact ?? 'n/a'}] ${v.id}: ${truncate(v.help || v.description || '', 140)}`);
    }
  }

  const broken = d.brokenLinks || (Array.isArray(d.links) ? d.links.filter((l) => l && l.broken) : null);
  if (Array.isArray(broken) && broken.length > 0) {
    lines.push(`Links rotos: ${broken.length}`);
    for (const b of broken.slice(0, 8)) {
      const url = typeof b === 'string' ? b : b.url;
      const status = typeof b === 'object' && b.status ? ` (${b.status})` : '';
      lines.push(`${truncate(url, 200)}${status}`);
    }
  }

  const missing = d.missing || d.securityHeaders?.missing;
  if (Array.isArray(missing) && missing.length > 0) {
    lines.push(`Headers de seguridad faltantes: ${missing.join(', ')}`);
  }

  if (typeof d.mismatchPercent === 'number') {
    lines.push(`Diferencia visual: ${d.mismatchPercent}% de píxeles distintos vs baseline`);
  }

  if (Array.isArray(d.findings) && d.findings.length > 0) {
    for (const f of d.findings.slice(0, 8)) {
      lines.push(typeof f === 'string' ? truncate(f, 200) : truncate(JSON.stringify(f), 200));
    }
  }

  return lines;
}

/**
 * Construye el contenido del bug. Devuelve { summary, descriptionAdf, labels }.
 *
 * @param {object} params
 * @param {{ id: string, url: string }} params.scan
 * @param {{ id, category, testName, status, score, details }} params.result
 * @param {string|null} [params.reportUrl] — link al reporte en el frontend
 */
export function buildBugContent({ scan, result, reportUrl }) {
  const host = safeHost(scan.url);
  const statusLabel = String(result.status || '').toUpperCase();
  const summary = truncate(
    `[QA Forge] ${result.category}/${result.testName} — ${statusLabel} en ${host}`,
    240,
  );

  const meta = [
    [adfText('URL escaneada: ', { strong: true }), adfText(scan.url)],
    [adfText('Categoría: ', { strong: true }), adfText(String(result.category))],
    [adfText('Test: ', { strong: true }), adfText(String(result.testName))],
    [
      adfText('Resultado: ', { strong: true }),
      adfText(
        statusLabel + (typeof result.score === 'number' ? ` · score ${result.score}` : ''),
      ),
    ],
    [adfText('Scan ID: ', { strong: true }), adfText(scan.id, { code: true })],
  ];

  const findings = summarizeFindings(result);

  const blocks = [
    adfParagraph('Bug detectado automáticamente por QA Forge durante un scan de QA.'),
    adfHeading('Detalle', 3),
    adfBulletList(meta),
  ];

  if (findings.length > 0) {
    blocks.push(adfHeading('Hallazgos', 3));
    blocks.push(adfBulletList(findings));
  }

  if (reportUrl) {
    blocks.push(
      adfParagraph([
        adfText('Reporte completo: '),
        adfText(reportUrl, { href: reportUrl }),
      ]),
    );
  }

  blocks.push(
    adfParagraph([
      adfText('Generado por QA Forge · automated QA', { code: true }),
    ]),
  );

  return {
    summary,
    descriptionAdf: adfDoc(blocks),
    labels: ['qa-forge', `qa-${result.category}`],
  };
}
