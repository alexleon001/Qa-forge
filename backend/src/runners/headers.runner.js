// Analiza los HTTP headers de seguridad presentes en la respuesta.
// No depende de Playwright — usa fetch nativo de Bun/Node.

import { DEFAULTS, RESULT_STATUS, SECURITY_HEADERS } from '../../../shared/constants.js';

export async function runHeadersCheck({ url, scanCtx } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DEFAULTS.HTTP_REQUEST_TIMEOUT_MS,
    );
    // Si llega cancel del usuario, abortar el fetch.
    const onCancel = () => controller.abort();
    scanCtx?.signal?.addEventListener('abort', onCancel, { once: true });

    // HEAD a veces falla, así que probamos GET con redirects.
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'QAForgeBot/0.1 (+headers-runner)',
      },
    });
    clearTimeout(timer);
    scanCtx?.signal?.removeEventListener?.('abort', onCancel);

    const headers = Object.fromEntries(response.headers.entries());

    // Evaluación de presencia de headers de seguridad clave.
    const present = SECURITY_HEADERS.filter((h) => h in headers);
    const missing = SECURITY_HEADERS.filter((h) => !(h in headers));

    // Status: pass si están todos, warning si faltan algunos, fail si faltan los críticos.
    const critical = ['strict-transport-security', 'content-security-policy'];
    const missingCritical = critical.filter((h) => missing.includes(h));

    let status;
    if (missing.length === 0) status = RESULT_STATUS.PASS;
    else if (missingCritical.length > 0) status = RESULT_STATUS.FAIL;
    else status = RESULT_STATUS.WARNING;

    return {
      status,
      data: {
        httpStatus: response.status,
        headersAll: headers,
        securityHeaders: { present, missing, missingCritical },
        contentType: headers['content-type'] || null,
        server: headers['server'] || null,
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
