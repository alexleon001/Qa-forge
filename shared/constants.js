// Constantes compartidas entre backend y frontend de QA Forge.

/** Status del Scan completo. */
export const SCAN_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

/** Status de cada Result individual de runner/analyzer. */
export const RESULT_STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  WARNING: 'warning',
  INFO: 'info',
});

/** Categorías de tests usadas para agrupar Results y calcular scores. */
export const TEST_CATEGORY = Object.freeze({
  FUNCTIONAL: 'functional',
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  ACCESSIBILITY: 'accessibility',
  SEO: 'seo',
});

/** Frameworks soportados por el Script Generator (FASE 3). */
export const SCRIPT_FRAMEWORK = Object.freeze({
  PLAYWRIGHT: 'playwright',
  CYPRESS: 'cypress',
  SELENIUM: 'selenium',
});

/** Lenguajes asociados a cada framework. */
export const SCRIPT_LANGUAGE = Object.freeze({
  TYPESCRIPT: 'typescript',
  JAVASCRIPT: 'javascript',
  PYTHON: 'python',
});

/** Etapas de un scan — se emiten al frontend vía Socket.io. */
export const SCAN_STAGE = Object.freeze({
  QUEUED: 'queued',
  LAUNCHING_BROWSER: 'launching_browser',
  CAPTURING_DOM: 'capturing_dom',
  ANALYZING_HEADERS: 'analyzing_headers',
  ANALYZING_SSL: 'analyzing_ssl',
  ANALYZING_SEO: 'analyzing_seo',
  CHECKING_LINKS: 'checking_links',
  ANALYZING_ACCESSIBILITY: 'analyzing_accessibility',
  ANALYZING_PERFORMANCE: 'analyzing_performance',
  GENERATING_SCRIPTS: 'generating_scripts',
  COMPLETED: 'completed',
});

/** Eventos de Socket.io. */
export const SOCKET_EVENT = Object.freeze({
  SCAN_PROGRESS: 'scan:progress',
  SCAN_RESULT: 'scan:result',
  SCAN_COMPLETED: 'scan:completed',
  SCAN_FAILED: 'scan:failed',
  SUBSCRIBE: 'scan:subscribe',
  UNSUBSCRIBE: 'scan:unsubscribe',
});

/** Nombre de la queue de BullMQ (no admite `:` en el nombre). */
export const QUEUE_NAME = 'qa-forge-scan';

/** Modelo de Claude usado por el Script Generator. */
export const CLAUDE_MODEL = 'claude-sonnet-4-6';

/** Headers de seguridad evaluados por security.analyzer / headers.runner. */
export const SECURITY_HEADERS = Object.freeze([
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
]);

/** Timeouts y límites por defecto (sobreescribibles vía env). */
export const DEFAULTS = Object.freeze({
  PLAYWRIGHT_TIMEOUT_MS: 30_000,
  HTTP_REQUEST_TIMEOUT_MS: 8_000,
  MAX_LINKS_TO_CHECK: 30,
  MAX_CONCURRENT_SCANS: 2,
  AXE_ANALYZE_TIMEOUT_MS: 20_000,
  PAGESPEED_TIMEOUT_MS: 60_000,
});
