// Verifica SSL/TLS del host (vencimiento, emisor, validez) con ssl-checker.

import sslChecker from 'ssl-checker';
import { RESULT_STATUS } from '../../../shared/constants.js';

export async function runSslCheck({ url } = {}) {
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
    const info = await sslChecker(parsed.hostname, { method: 'GET', port });

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
