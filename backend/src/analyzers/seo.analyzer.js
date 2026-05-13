// Analiza la data capturada por Playwright y emite un score SEO 0-100.
// Función pura: no hace requests, opera sobre `captureData`.

import { RESULT_STATUS } from '../../../shared/constants.js';

/**
 * @param {{ captureData: any }} input
 */
export function analyzeSeo({ captureData } = {}) {
  if (!captureData) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: 'No hay data de Playwright para analizar SEO',
    };
  }

  const meta = captureData.meta || {};
  const title = captureData.title || '';
  const headings = captureData.headings || { h1: [], h2: [] };
  const findings = [];
  let score = 100;

  // Title
  if (!title) {
    findings.push({ severity: 'critical', issue: 'Falta <title>' });
    score -= 20;
  } else if (title.length < 10 || title.length > 70) {
    findings.push({
      severity: 'warning',
      issue: `Title fuera de rango óptimo (10-70 chars), actual: ${title.length}`,
    });
    score -= 5;
  }

  // Meta description
  const description = meta.description || meta['og:description'] || null;
  if (!description) {
    findings.push({ severity: 'critical', issue: 'Falta meta description' });
    score -= 15;
  } else if (description.length < 50 || description.length > 160) {
    findings.push({
      severity: 'warning',
      issue: `Meta description fuera de rango óptimo (50-160 chars), actual: ${description.length}`,
    });
    score -= 5;
  }

  // OG tags
  const ogTags = ['og:title', 'og:description', 'og:image', 'og:url'];
  const missingOg = ogTags.filter((tag) => !meta[tag]);
  if (missingOg.length > 0) {
    findings.push({
      severity: missingOg.length >= 3 ? 'warning' : 'info',
      issue: `Open Graph incompleto, faltan: ${missingOg.join(', ')}`,
    });
    score -= missingOg.length * 3;
  }

  // Twitter card
  if (!meta['twitter:card']) {
    findings.push({ severity: 'info', issue: 'Falta twitter:card' });
    score -= 3;
  }

  // Robots
  const robots = meta.robots || '';
  if (robots.toLowerCase().includes('noindex')) {
    findings.push({
      severity: 'critical',
      issue: 'meta robots contiene "noindex" — la página no será indexada',
    });
    score -= 25;
  }

  // Canonical
  if (!meta.canonical && !captureData.htmlLang) {
    findings.push({
      severity: 'info',
      issue: 'No se detectó <link rel="canonical"> ni atributo lang en <html>',
    });
    score -= 3;
  }

  // Headings: debería haber exactamente 1 H1
  const h1Count = headings.h1?.length ?? 0;
  if (h1Count === 0) {
    findings.push({ severity: 'critical', issue: 'No hay <h1> en la página' });
    score -= 15;
  } else if (h1Count > 1) {
    findings.push({
      severity: 'warning',
      issue: `Se encontraron ${h1Count} elementos <h1>, lo recomendado es 1`,
    });
    score -= 5;
  }

  // Lang
  if (!captureData.htmlLang) {
    findings.push({ severity: 'warning', issue: 'Falta atributo lang en <html>' });
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));
  const status = pickStatus(score, findings);

  return {
    status,
    data: {
      score,
      title,
      titleLength: title.length,
      description,
      descriptionLength: description?.length ?? 0,
      hasOgTags: missingOg.length === 0,
      missingOg,
      h1Count,
      h2Count: headings.h2?.length ?? 0,
      hasCanonical: Boolean(meta.canonical),
      htmlLang: captureData.htmlLang,
      indexable: !robots.toLowerCase().includes('noindex'),
      findings,
    },
    error: null,
  };
}

function pickStatus(score, findings) {
  const hasCritical = findings.some((f) => f.severity === 'critical');
  if (hasCritical || score < 60) return RESULT_STATUS.FAIL;
  if (score < 85) return RESULT_STATUS.WARNING;
  return RESULT_STATUS.PASS;
}
