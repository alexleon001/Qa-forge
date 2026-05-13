// Combina headers + ssl + protocol en un score 0-100 de seguridad.

import { RESULT_STATUS } from '../../../shared/constants.js';

const WEIGHTS = {
  https: 15,
  strictTransportSecurity: 15,
  contentSecurityPolicy: 15,
  xFrameOptions: 10,
  xContentTypeOptions: 10,
  referrerPolicy: 5,
  permissionsPolicy: 5,
  sslValid: 15,
  sslLongLived: 10, // > 30 días
};

export function analyzeSecurity({ url, headersData, sslData } = {}) {
  let score = 0;
  const findings = [];

  let protocol = null;
  try {
    protocol = new URL(url).protocol;
  } catch {
    protocol = null;
  }

  // HTTPS
  if (protocol === 'https:') {
    score += WEIGHTS.https;
  } else {
    findings.push({ severity: 'critical', issue: 'La URL no usa HTTPS' });
  }

  // Headers de seguridad
  const present = new Set(headersData?.securityHeaders?.present ?? []);

  if (present.has('strict-transport-security')) score += WEIGHTS.strictTransportSecurity;
  else findings.push({ severity: 'critical', issue: 'Falta header Strict-Transport-Security' });

  if (present.has('content-security-policy')) score += WEIGHTS.contentSecurityPolicy;
  else findings.push({ severity: 'critical', issue: 'Falta header Content-Security-Policy' });

  if (present.has('x-frame-options')) score += WEIGHTS.xFrameOptions;
  else findings.push({ severity: 'warning', issue: 'Falta X-Frame-Options' });

  if (present.has('x-content-type-options')) score += WEIGHTS.xContentTypeOptions;
  else findings.push({ severity: 'warning', issue: 'Falta X-Content-Type-Options' });

  if (present.has('referrer-policy')) score += WEIGHTS.referrerPolicy;
  else findings.push({ severity: 'info', issue: 'Falta Referrer-Policy' });

  if (present.has('permissions-policy')) score += WEIGHTS.permissionsPolicy;
  else findings.push({ severity: 'info', issue: 'Falta Permissions-Policy' });

  // SSL
  if (sslData?.valid) {
    score += WEIGHTS.sslValid;
    if (sslData.daysRemaining > 30) score += WEIGHTS.sslLongLived;
    else
      findings.push({
        severity: 'warning',
        issue: `Certificado SSL vence en ${sslData.daysRemaining} días`,
      });
  } else if (protocol === 'https:') {
    findings.push({ severity: 'critical', issue: 'Certificado SSL inválido o no verificable' });
  }

  score = Math.max(0, Math.min(100, score));

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasWarning = findings.some((f) => f.severity === 'warning');
  const status = hasCritical || score < 50
    ? RESULT_STATUS.FAIL
    : hasWarning || score < 80
      ? RESULT_STATUS.WARNING
      : RESULT_STATUS.PASS;

  return {
    status,
    data: {
      score,
      protocol,
      headersPresent: Array.from(present),
      headersMissing: headersData?.securityHeaders?.missing ?? [],
      sslValid: sslData?.valid ?? false,
      sslDaysRemaining: sslData?.daysRemaining ?? null,
      findings,
    },
    error: null,
  };
}
