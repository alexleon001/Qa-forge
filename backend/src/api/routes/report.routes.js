// Reportes de scans + exportación JSON/HTML.

import { Router } from 'express';

import { HttpError } from '../middlewares/error.middleware.js';
import { parseDetails, prisma } from '../../db/client.js';
import { renderReportHtml } from '../../reports/html.template.js';
import { RESULT_STATUS, TEST_CATEGORY } from '../../../../shared/constants.js';

export const reportRouter = Router();

async function loadReport(scanId) {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: { results: { orderBy: { createdAt: 'asc' } } },
  });
  if (!scan) throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');

  const byCategory = {};
  for (const cat of Object.values(TEST_CATEGORY)) byCategory[cat] = [];

  for (const result of scan.results) {
    const list = byCategory[result.category] ?? (byCategory[result.category] = []);
    list.push({
      id: result.id,
      testName: result.testName,
      status: result.status,
      score: result.score,
      details: parseDetails(result.details),
      createdAt: result.createdAt,
    });
  }

  const totals = {
    total: scan.results.length,
    pass: scan.results.filter((r) => r.status === RESULT_STATUS.PASS).length,
    fail: scan.results.filter((r) => r.status === RESULT_STATUS.FAIL).length,
    warning: scan.results.filter((r) => r.status === RESULT_STATUS.WARNING).length,
    info: scan.results.filter((r) => r.status === RESULT_STATUS.INFO).length,
  };

  // Score por categoría: promedio de results con score numérico.
  const scoreByCategory = {};
  for (const cat of Object.values(TEST_CATEGORY)) {
    const scored = byCategory[cat].filter((r) => typeof r.score === 'number');
    if (scored.length > 0) {
      scoreByCategory[cat] = Math.round(
        scored.reduce((sum, r) => sum + r.score, 0) / scored.length,
      );
    }
  }

  return {
    scan: {
      id: scan.id,
      url: scan.url,
      status: scan.status,
      stage: scan.stage,
      errorMessage: scan.errorMessage,
      createdAt: scan.createdAt,
      startedAt: scan.startedAt,
      completedAt: scan.completedAt,
    },
    totals,
    scoreByCategory,
    byCategory,
  };
}

reportRouter.get('/:id', async (req, res, next) => {
  try {
    const report = await loadReport(req.params.id);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/:id/export', async (req, res, next) => {
  try {
    const format = (req.query.format || 'json').toString().toLowerCase();
    const report = await loadReport(req.params.id);
    const filename = `qa-forge-report-${report.scan.id}.${format}`;

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(report, null, 2));
      return;
    }

    if (format === 'html') {
      const html = renderReportHtml(report);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(html);
      return;
    }

    throw new HttpError(400, 'INVALID_FORMAT', 'Formato no soportado. Usar json|html.');
  } catch (err) {
    next(err);
  }
});
