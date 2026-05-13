// Middleware global de manejo de errores para Express.

export function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(err, _req, res, _next) {
  const status = typeof err.status === 'number' ? err.status : 500;
  const payload = {
    error: err.code || 'INTERNAL_ERROR',
    message: err.message || 'Error inesperado en el servidor',
  };
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    payload.stack = err.stack;
  }
  if (status >= 500) {
    console.error('[error.middleware]', err);
  }
  res.status(status).json(payload);
}

/**
 * Crea un error HTTP con `status` y `code` para el handler.
 */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
