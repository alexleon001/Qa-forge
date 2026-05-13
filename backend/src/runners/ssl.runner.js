// Verifica SSL/TLS del host directamente con node:tls (compatible con Bun).
// Reemplazo de ssl-checker que crasheaba en Bun por usar https.request.

import { connect } from 'node:tls';

import { RESULT_STATUS } from '../../../shared/constants.js';

const SSL_TIMEOUT_MS = 10_000;

export async function runSslCheck({ url, scanCtx } = {}) {
  void scanCtx;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return {
        status: RESULT_STATUS.FAIL,
        data: {
          protocol: parsed.protocol,
          host: parsed.host,
          message: 'La URL no usa HTTPS',
        },
        error: null,
      };
    }

    const port = parsed.port ? Number(parsed.port) : 443;
    const info = await fetchCertificate(parsed.hostname, port, SSL_TIMEOUT_MS);

    let status;
    if (!info.valid) status = RESULT_STATUS.FAIL;
    else if (info.daysRemaining < 14) status = RESULT_STATUS.WARNING;
    else status = RESULT_STATUS.PASS;

    return {
      status,
      data: {
        host: parsed.hostname,
        port,
        valid: info.valid,
        validFrom: info.validFrom,
        validTo: info.validTo,
        daysRemaining: info.daysRemaining,
        validFor: info.validFor ?? [],
        issuer: info.issuer ?? null,
      },
      error: null,
    };
  } catch (err) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Conecta vía TLS al host y devuelve info del peer certificate.
 * Compatible con Bun (usa tls.connect directo, sin https.request).
 */
function fetchCertificate(hostname, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const socket = connect(
      {
        host: hostname,
        port,
        servername: hostname,
        // Aceptamos certs inválidos — queremos reportarlos, no rechazarlos.
        rejectUnauthorized: false,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate?.(true);
          socket.end();
          if (!cert || Object.keys(cert).length === 0) {
            return finish(reject, new Error('No se pudo obtener el peer certificate'));
          }
          const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
          const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
          const now = new Date();
          const valid = Boolean(
            validFrom && validTo && now >= validFrom && now <= validTo,
          );
          const daysRemaining = validTo
            ? Math.floor((validTo.getTime() - now.getTime()) / 86_400_000)
            : null;
          finish(resolve, {
            valid,
            validFrom: cert.valid_from ?? null,
            validTo: cert.valid_to ?? null,
            daysRemaining,
            issuer: cert.issuer ?? null,
            validFor: extractSans(cert),
          });
        } catch (err) {
          try {
            socket.destroy();
          } catch {}
          finish(reject, err instanceof Error ? err : new Error(String(err)));
        }
      },
    );

    socket.setTimeout(timeoutMs, () => {
      try {
        socket.destroy();
      } catch {}
      finish(reject, new Error(`TLS connect timeout (${timeoutMs}ms) para ${hostname}:${port}`));
    });

    socket.on('error', (err) => {
      finish(reject, err);
    });
  });
}

/** Extrae los Subject Alternative Names del certificado, si existen. */
function extractSans(cert) {
  if (!cert?.subjectaltname) return [];
  return cert.subjectaltname
    .split(',')
    .map((s) => s.trim().replace(/^DNS:/, ''))
    .filter(Boolean);
}
