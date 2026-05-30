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
  VISUAL: 'visual',
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
  LOGIN_PREFLIGHT: 'login_preflight',
  DISCOVERING_URLS: 'discovering_urls',
  LAUNCHING_BROWSER: 'launching_browser',
  CAPTURING_DOM: 'capturing_dom',
  ANALYZING_HEADERS: 'analyzing_headers',
  ANALYZING_SSL: 'analyzing_ssl',
  ANALYZING_SEO: 'analyzing_seo',
  CHECKING_LINKS: 'checking_links',
  ANALYZING_ACCESSIBILITY: 'analyzing_accessibility',
  ANALYZING_PERFORMANCE: 'analyzing_performance',
  ANALYZING_VISUAL: 'analyzing_visual',
  GENERATING_SCRIPTS: 'generating_scripts',
  COMPLETED: 'completed',
});

/** Modo de scan. `single` = una sola URL (default). `crawl` = parent que dispara child scans. */
export const SCAN_MODE = Object.freeze({
  SINGLE: 'single',
  CRAWL: 'crawl',
});

/** Tope absoluto del crawler — máximo de páginas hijas por scan padre. */
export const MAX_CRAWL_PAGES = 15;

/**
 * Engines de browser soportados. Los 3 están bundled con Playwright (basta con
 * `bunx playwright install <engine>`). Default `chromium` mantiene el comportamiento
 * histórico. Pasar al runner via Scan.browserEngine.
 */
export const BROWSER_ENGINES = Object.freeze({
  chromium: { id: 'chromium', label: 'Chromium', icon: '🟢' },
  firefox: { id: 'firefox', label: 'Firefox', icon: '🦊' },
  webkit: { id: 'webkit', label: 'WebKit (Safari)', icon: '🧭' },
});

export const DEFAULT_BROWSER_ENGINE = 'chromium';

/** Eventos de Socket.io. */
export const SOCKET_EVENT = Object.freeze({
  SCAN_PROGRESS: 'scan:progress',
  SCAN_RESULT: 'scan:result',
  SCAN_COMPLETED: 'scan:completed',
  SCAN_FAILED: 'scan:failed',
  SUBSCRIBE: 'scan:subscribe',
  UNSUBSCRIBE: 'scan:unsubscribe',
  // AI exploratory testing (sesión independiente, room `explore:<id>`).
  EXPLORE_SUBSCRIBE: 'explore:subscribe',
  EXPLORE_UNSUBSCRIBE: 'explore:unsubscribe',
  EXPLORE_PROGRESS: 'explore:progress',
  EXPLORE_STEP: 'explore:step',
  EXPLORE_FINDING: 'explore:finding',
  EXPLORE_COMPLETED: 'explore:completed',
  EXPLORE_FAILED: 'explore:failed',
});

/** AI exploratory testing — límites y vocabularios. */
export const DEFAULT_EXPLORE_MAX_STEPS = 15;
export const MAX_EXPLORE_STEPS = 40;

/** Acciones que el agente exploratorio puede pedir en cada paso. */
export const EXPLORE_ACTIONS = Object.freeze(['click', 'fill', 'navigate', 'back', 'finish']);

/** Severidades de un hallazgo exploratorio (orden de mayor a menor). */
export const FINDING_SEVERITY = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);

/** Nombre de la queue de BullMQ (no admite `:` en el nombre). */
export const QUEUE_NAME = 'qa-forge-scan';

/** Modelo de Claude usado por el Script Generator. */
export const CLAUDE_MODEL = 'claude-sonnet-4-6';

/**
 * Perfiles de dispositivo soportados al iniciar un scan. Mapeamos a Playwright
 * `devices` en los runners. `desktop` es el default histórico (sin emulación).
 */
export const DEVICE_PROFILES = Object.freeze({
  desktop: {
    id: 'desktop',
    label: 'Desktop (1366×768)',
    playwrightDevice: null,
    viewport: { width: 1366, height: 768 },
    isMobile: false,
  },
  'desktop-1080p': {
    id: 'desktop-1080p',
    label: 'Desktop FullHD (1920×1080)',
    playwrightDevice: null,
    viewport: { width: 1920, height: 1080 },
    isMobile: false,
  },
  tablet: {
    id: 'tablet',
    label: 'Tablet (iPad Pro 11)',
    playwrightDevice: 'iPad Pro 11',
    viewport: null, // tomado del device
    isMobile: true,
  },
  'iphone-13': {
    id: 'iphone-13',
    label: 'iPhone 13',
    playwrightDevice: 'iPhone 13',
    viewport: null,
    isMobile: true,
  },
  'iphone-15-pro': {
    id: 'iphone-15-pro',
    label: 'iPhone 15 Pro',
    playwrightDevice: 'iPhone 15 Pro',
    viewport: null,
    isMobile: true,
  },
  'pixel-7': {
    id: 'pixel-7',
    label: 'Pixel 7 (Android)',
    playwrightDevice: 'Pixel 7',
    viewport: null,
    isMobile: true,
  },
});

export const DEFAULT_DEVICE_PROFILE = 'desktop';

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

// ─── FASE 9: Runner de casos de prueba manuales ─────────────────────────────

/** Estado de ejecución de un caso en el runner manual. */
export const MANUAL_RUN_STATUS = Object.freeze({
  PENDING: 'pending', // todavía no ejecutado
  PASS: 'pass', // ejecutado y correcto
  FAIL: 'fail', // ejecutado y falló
  BLOCKED: 'blocked', // no se pudo ejecutar (bloqueado por otro problema)
  SKIPPED: 'skipped', // se decidió no ejecutar
});

/** Origen de un caso dentro del runner manual. */
export const MANUAL_CASE_SOURCE = Object.freeze({
  GENERIC: 'generic', // del catálogo fijo GENERIC_TEST_CASES
  AI: 'ai', // generado por el LLM (manualcases.generator)
  CUSTOM: 'custom', // creado a mano por el usuario
});

/** Prioridades válidas de un caso manual (compartido con el generador de IA). */
export const MANUAL_CASE_PRIORITY = Object.freeze(['critical', 'high', 'medium', 'low']);

/**
 * Catálogo fijo de casos de prueba "genéricos" — los chequeos que se corren en
 * cualquier web, sin importar su rubro. Funcionan como checklist base del runner
 * manual: siempre se muestran y arrancan en estado `pending`. `category` usa los
 * valores de TEST_CATEGORY para agruparlos junto a los casos IA y custom.
 */
export const GENERIC_TEST_CASES = Object.freeze([
  // ── Funcional / UX / responsive ──────────────────────────────────────────
  {
    key: 'gen-func-01',
    category: 'functional',
    priority: 'critical',
    title: 'La página principal carga sin errores',
    description:
      'Abrir la URL: debe responder HTTP 200, renderizar contenido visible y no quedar en blanco ni mostrar errores del servidor.',
  },
  {
    key: 'gen-func-02',
    category: 'functional',
    priority: 'high',
    title: 'Sin errores en la consola del navegador',
    description:
      'Abrir DevTools (F12) → pestaña Console y recargar. No debe haber errores rojos de JS ni recursos que fallen al cargar.',
  },
  {
    key: 'gen-func-03',
    category: 'functional',
    priority: 'high',
    title: 'Los links del menú y header navegan correctamente',
    description:
      'Recorrer cada link del menú principal/header y verificar que lleva al destino esperado sin errores.',
  },
  {
    key: 'gen-func-04',
    category: 'functional',
    priority: 'high',
    title: 'No hay links rotos ni imágenes que no cargan',
    description:
      'Revisar que ningún enlace devuelva 404 y que todas las imágenes se muestren (sin íconos de imagen rota).',
  },
  {
    key: 'gen-func-05',
    category: 'functional',
    priority: 'medium',
    title: 'El logo del header lleva al inicio',
    description: 'Hacer click en el logo desde una página interna: debe volver al home.',
  },
  {
    key: 'gen-func-06',
    category: 'functional',
    priority: 'low',
    title: 'El footer expone links legales y de contacto',
    description:
      'Verificar presencia de enlaces a privacidad, términos y contacto en el footer, y que funcionen.',
  },
  {
    key: 'gen-func-07',
    category: 'functional',
    priority: 'medium',
    title: 'La página 404 personalizada funciona',
    description:
      'Visitar una URL inexistente del sitio: debe mostrar una página 404 amigable con navegación de vuelta, no un error crudo.',
  },
  {
    key: 'gen-func-08',
    category: 'functional',
    priority: 'high',
    title: 'El sitio es responsive (mobile, tablet, desktop)',
    description:
      'Probar la página en anchos de mobile, tablet y desktop: el layout se adapta sin scroll horizontal ni elementos solapados.',
  },
  {
    key: 'gen-func-09',
    category: 'functional',
    priority: 'medium',
    title: 'El botón "atrás" del navegador mantiene el estado',
    description:
      'Navegar a una sección interna y volver con el botón atrás: la página anterior se restaura en el estado esperado.',
  },
  {
    key: 'gen-func-10',
    category: 'functional',
    priority: 'high',
    title: 'Los formularios validan campos requeridos y formatos',
    description:
      'Enviar cada formulario vacío y con datos inválidos: debe mostrar mensajes de validación claros y no enviar.',
  },
  {
    key: 'gen-func-11',
    category: 'functional',
    priority: 'low',
    title: 'El favicon se muestra en la pestaña',
    description: 'La pestaña del navegador muestra el favicon del sitio, no el genérico.',
  },
  {
    key: 'gen-func-12',
    category: 'functional',
    priority: 'medium',
    title: 'Funciona en los navegadores principales',
    description:
      'Verificar el sitio en Chrome, Firefox y Safari/Edge: sin diferencias funcionales ni visuales graves.',
  },
  // ── Seguridad ─────────────────────────────────────────────────────────────
  {
    key: 'gen-sec-01',
    category: 'security',
    priority: 'critical',
    title: 'El sitio se sirve por HTTPS y HTTP redirige',
    description:
      'Acceder por http:// debe redirigir a https://. Toda la navegación queda bajo HTTPS (candado en la barra).',
  },
  {
    key: 'gen-sec-02',
    category: 'security',
    priority: 'high',
    title: 'El certificado SSL es válido y vigente',
    description:
      'El certificado no está vencido, próximo a vencer ni emitido para otro dominio.',
  },
  {
    key: 'gen-sec-03',
    category: 'security',
    priority: 'high',
    title: 'Headers de seguridad presentes',
    description:
      'Revisar respuesta HTTP: HSTS, Content-Security-Policy y X-Frame-Options presentes y razonables.',
  },
  {
    key: 'gen-sec-04',
    category: 'security',
    priority: 'high',
    title: 'Los inputs sanitizan XSS',
    description:
      'Ingresar `<script>alert(1)</script>` en campos de texto/búsqueda: el sitio no debe ejecutar el script.',
  },
  {
    key: 'gen-sec-05',
    category: 'security',
    priority: 'high',
    title: 'Resistencia a SQL injection en campos clave',
    description:
      "Probar `' OR '1'='1` en login y búsqueda: no debe alterar resultados ni exponer errores de base de datos.",
  },
  {
    key: 'gen-sec-06',
    category: 'security',
    priority: 'medium',
    title: 'No se exponen datos sensibles en cliente',
    description:
      'Revisar código fuente, comentarios HTML y consola: sin API keys, credenciales ni rutas internas expuestas.',
  },
  // ── Performance ───────────────────────────────────────────────────────────
  {
    key: 'gen-perf-01',
    category: 'performance',
    priority: 'high',
    title: 'La página carga en menos de 3 segundos',
    description:
      'Medir el tiempo hasta contenido visible en una conexión normal: objetivo por debajo de 3s.',
  },
  {
    key: 'gen-perf-02',
    category: 'performance',
    priority: 'medium',
    title: 'Las imágenes están optimizadas',
    description:
      'Verificar que las imágenes usan formatos y pesos adecuados, y lazy-loading donde aplica.',
  },
  {
    key: 'gen-perf-03',
    category: 'performance',
    priority: 'medium',
    title: 'Sin saltos de layout bruscos al cargar',
    description:
      'Al cargar la página el contenido no debe "saltar" (Cumulative Layout Shift bajo).',
  },
  // ── Accesibilidad ─────────────────────────────────────────────────────────
  {
    key: 'gen-a11y-01',
    category: 'accessibility',
    priority: 'high',
    title: 'Navegable completamente con teclado',
    description:
      'Recorrer la página solo con Tab/Shift+Tab/Enter/Esc: se puede llegar y operar todo elemento interactivo.',
  },
  {
    key: 'gen-a11y-02',
    category: 'accessibility',
    priority: 'medium',
    title: 'Las imágenes tienen texto alternativo',
    description: 'Cada imagen informativa tiene atributo alt descriptivo; las decorativas, alt vacío.',
  },
  {
    key: 'gen-a11y-03',
    category: 'accessibility',
    priority: 'medium',
    title: 'El contraste de texto cumple WCAG AA',
    description:
      'El contraste entre texto y fondo cumple el ratio mínimo de WCAG AA (4.5:1 texto normal).',
  },
  {
    key: 'gen-a11y-04',
    category: 'accessibility',
    priority: 'medium',
    title: 'El foco es visible en elementos interactivos',
    description:
      'Al tabular, cada link/botón/campo muestra un indicador de foco claramente visible.',
  },
  {
    key: 'gen-a11y-05',
    category: 'accessibility',
    priority: 'low',
    title: 'La página funciona con zoom al 200%',
    description:
      'Con zoom del navegador al 200% el contenido sigue legible y usable, sin pérdida de funcionalidad.',
  },
  // ── SEO ───────────────────────────────────────────────────────────────────
  {
    key: 'gen-seo-01',
    category: 'seo',
    priority: 'medium',
    title: 'Title y meta description únicos y descriptivos',
    description:
      'La página tiene <title> y meta description presentes, descriptivos y de largo adecuado.',
  },
  {
    key: 'gen-seo-02',
    category: 'seo',
    priority: 'medium',
    title: 'Un único H1 y jerarquía de headings correcta',
    description: 'Existe un solo <h1> y los headings siguen un orden jerárquico sin saltos.',
  },
  {
    key: 'gen-seo-03',
    category: 'seo',
    priority: 'low',
    title: 'Open Graph tags presentes',
    description:
      'Al compartir la URL en redes/chats se muestra un preview correcto (og:title, og:description, og:image).',
  },
  {
    key: 'gen-seo-04',
    category: 'seo',
    priority: 'low',
    title: 'robots.txt y sitemap.xml accesibles',
    description: 'Verificar que /robots.txt y /sitemap.xml existen y son coherentes.',
  },
]);
