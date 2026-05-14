// Convierte el HTML del reporte en un PDF usando Playwright (Chromium).
// Reusa el binario que ya está descargado y el template HTML inline existente.

import { chromium } from 'playwright';

import { renderReportHtml } from './html.template.js';

const PDF_TIMEOUT_MS = 30_000;

/**
 * Renderiza un reporte como PDF (A4, vertical, márgenes 16mm). Devuelve un Buffer.
 * @param {object} report — payload de `loadReport(scanId)`
 * @returns {Promise<Buffer>}
 */
export async function renderReportPdf(report) {
  const html = wrapForPrint(renderReportHtml(report));

  const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.setContent(html, {
      waitUntil: 'networkidle',
      timeout: PDF_TIMEOUT_MS,
    });

    // El template del HTML usa color-scheme dark; forzamos `print` color para
    // que Chromium respete los backgrounds oscuros en el PDF.
    await page.emulateMedia({ media: 'print' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-size:9px;color:#94a3b8;width:100%;padding:0 14mm;display:flex;justify-content:space-between;">
          <span>QA Forge — Reporte de scan</span>
          <span class="title"></span>
        </div>`,
      footerTemplate: `
        <div style="font-size:9px;color:#94a3b8;width:100%;padding:0 14mm;display:flex;justify-content:space-between;">
          <span class="date"></span>
          <span>Página <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
    });

    return pdf;
  } finally {
    await browser?.close().catch(() => {});
  }
}

/**
 * Inyecta @page CSS y ajustes pequeños para impresión sin tocar el template
 * original (que se sigue usando para export HTML).
 */
function wrapForPrint(html) {
  const printCss = `
    <style>
      @page { size: A4; margin: 0; }
      @media print {
        body { background: #020617 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .test, pre { page-break-inside: avoid; }
        h2 { page-break-after: avoid; }
        pre { max-height: none !important; }
      }
    </style>`;
  return html.replace('</head>', `${printCss}</head>`);
}
