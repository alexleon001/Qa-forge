// Inyecta axe-core en la página vía @axe-core/playwright y reporta violaciones.

import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';

import { DEFAULTS, RESULT_STATUS } from '../../../shared/constants.js';

export async function runAccessibilityCheck({ url } = {}) {
  let browser;
  try {
    const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;
    browser = await chromium.launch({ headless: true, channel });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; QAForgeBot/0.1; +a11y-runner)',
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULTS.PLAYWRIGHT_TIMEOUT_MS,
    });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    const axe = new AxeBuilder({ page }).withTags([
      'wcag2a',
      'wcag2aa',
      'wcag21a',
      'wcag21aa',
      'best-practice',
    ]);
    // Timeout duro para axe — en DOMs grandes puede tardar mucho.
    const results = await Promise.race([
      axe.analyze(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('axe.analyze timeout')),
          DEFAULTS.AXE_ANALYZE_TIMEOUT_MS,
        ),
      ),
    ]);

    const byImpact = countBy(results.violations, 'impact');
    const totalViolations = results.violations.length;

    // Score 0-100: 100 - (críticas*15 + serias*8 + moderadas*3 + menores*1)
    const score = Math.max(
      0,
      100 -
        ((byImpact.critical || 0) * 15 +
          (byImpact.serious || 0) * 8 +
          (byImpact.moderate || 0) * 3 +
          (byImpact.minor || 0) * 1),
    );

    let status;
    if (byImpact.critical > 0 || score < 60) status = RESULT_STATUS.FAIL;
    else if (totalViolations > 0 || score < 85) status = RESULT_STATUS.WARNING;
    else status = RESULT_STATUS.PASS;

    // Compactamos violations para no inflar la DB (axe devuelve mucha info por nodo).
    const violations = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      helpUrl: v.helpUrl,
      tags: v.tags,
      nodes: v.nodes.length,
      sample: v.nodes.slice(0, 3).map((n) => ({
        html: (n.html || '').slice(0, 200),
        target: n.target,
        failureSummary: (n.failureSummary || '').slice(0, 300),
      })),
    }));

    return {
      status,
      data: {
        score,
        totalViolations,
        byImpact,
        passes: results.passes.length,
        incomplete: results.incomplete.length,
        violations,
      },
      error: null,
    };
  } catch (err) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

function countBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}
