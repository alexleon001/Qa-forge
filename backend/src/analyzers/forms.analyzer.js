// Inspecciona los forms capturados por Playwright y reporta hallazgos.
// Evalúa accesibilidad básica (labels, autocomplete, required) y seguridad
// (action absoluto, https, csrf hint).

import { RESULT_STATUS } from '../../../shared/constants.js';

export function analyzeForms({ captureData, baseUrl } = {}) {
  if (!captureData) {
    return {
      status: RESULT_STATUS.INFO,
      data: null,
      error: 'No hay data de Playwright para analizar forms',
    };
  }

  const forms = captureData.forms || [];
  if (forms.length === 0) {
    return {
      status: RESULT_STATUS.INFO,
      data: { total: 0, forms: [], findings: [] },
      error: null,
    };
  }

  const baseProtocol = (() => {
    try {
      return new URL(baseUrl).protocol;
    } catch {
      return null;
    }
  })();

  const findings = [];
  const annotated = forms.map((form, idx) => {
    const issues = [];
    const inputs = form.inputs || [];

    // method GET con inputs de tipo password = bandera roja
    const passwords = inputs.filter((i) => i.type === 'password');
    if (passwords.length > 0 && form.method === 'GET') {
      issues.push({ severity: 'critical', issue: 'Form con password envía por GET' });
    }

    // action en http si la página es https
    if (form.action && baseProtocol === 'https:' && form.action.startsWith('http://')) {
      issues.push({ severity: 'critical', issue: 'Form en https con action http://' });
    }

    // Inputs sin name → no se envían al backend
    const unnamed = inputs.filter((i) => !i.name && i.tag === 'input' && i.type !== 'submit' && i.type !== 'button');
    if (unnamed.length > 0) {
      issues.push({
        severity: 'warning',
        issue: `${unnamed.length} input(s) sin atributo name`,
      });
    }

    // csrf hint (input hidden con name csrf, _token, etc.)
    const hasCsrfHint = inputs.some((i) =>
      i.type === 'hidden' &&
      /^(csrf|_token|authenticity_token|__requestverificationtoken)/i.test(i.name || ''),
    );
    if (passwords.length > 0 && !hasCsrfHint && form.method !== 'GET') {
      issues.push({
        severity: 'warning',
        issue: 'Form de login sin token CSRF visible',
      });
    }

    // Inputs sin placeholder/aria-label/id (heurística básica de accesibilidad — análisis profundo va en axe)
    const noPlaceholder = inputs.filter(
      (i) => !i.placeholder && !i.id && (i.tag === 'input' || i.tag === 'textarea'),
    );
    if (noPlaceholder.length > 0) {
      issues.push({
        severity: 'info',
        issue: `${noPlaceholder.length} input(s) sin placeholder ni id (revisar accesibilidad)`,
      });
    }

    findings.push(...issues.map((i) => ({ ...i, formIndex: idx })));

    return {
      index: idx,
      id: form.id,
      name: form.name,
      action: form.action,
      method: form.method,
      inputCount: inputs.length,
      passwordFields: passwords.length,
      hasCsrfHint,
      issues,
    };
  });

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasWarning = findings.some((f) => f.severity === 'warning');
  const status = hasCritical ? RESULT_STATUS.FAIL : hasWarning ? RESULT_STATUS.WARNING : RESULT_STATUS.PASS;

  return {
    status,
    data: { total: forms.length, forms: annotated, findings },
    error: null,
  };
}
