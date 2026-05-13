// Verifica SSL/TLS del host (vencimiento, emisor, validez) con ssl-checker.

import sslChecker from 'ssl-checker';
import { RESULT_STATUS } from '../../../shared/constants.js';

const SSL_TIMEOUT_MS = 10_000;

export async function runSslCheck({ url, scanCtx } = {}) {
  // El scanCtx no se usa directamente — ssl-checker no expone signal — pero
  // el timeout duro de Promise.race garantiza que el runner termine en ≤10s.
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
    // ssl-checker no tiene timeout propio — si el handshake TLS cuelga, espera
    // infinito. Wrappeamos con Promise.race para abortar a los 10s.
    const info = await Promise.race([
      sslChecker(parsed.hostname, { method: 'GET', port }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`SSL check timeout (${SSL_TIMEOUT_MS}ms) para ${parsed.hostname}:${port}`)),
          SSL_TIMEOUT_MS,
        ),
      ),
    ]);

    // info: { valid, validFrom, validTo, daysRemaining, validFor }
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
