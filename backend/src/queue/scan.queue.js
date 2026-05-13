// BullMQ queue para procesar scans de forma asíncrona.
// Encadena runners + analyzers de FASE 1 y FASE 2, persiste Results y emite
// progreso vía Socket.io. Errores individuales no detienen el scan.

import { Queue, Worker } from 'bullmq';

import { prisma, serializeDetails } from '../db/client.js';
import {
  DEFAULTS,
  QUEUE_NAME,
  RESULT_STATUS,
  SCAN_STAGE,
  SCAN_STATUS,
  TEST_CATEGORY,
} from '../../../shared/constants.js';
import {
  emitCompleted,
  emitFailed,
  emitProgress,
  emitResult,
} from '../sockets/scan.socket.js';
import { analyzeForms } from '../analyzers/forms.analyzer.js';
import { analyzeLinks } from '../analyzers/links.analyzer.js';
import { analyzeSecurity } from '../analyzers/security.analyzer.js';
import { analyzeSeo } from '../analyzers/seo.analyzer.js';
import { runAccessibilityCheck } from '../runners/accessibility.runner.js';
import { runHeadersCheck } from '../runners/headers.runner.js';
import { runPageSpeedCheck } from '../runners/pagespeed.runner.js';
import { runPlaywrightCapture } from '../runners/playwright.runner.js';
import { runSslCheck } from '../runners/ssl.runner.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function buildConnection() {
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    maxRetriesPerRequest: null,
  };
}

// La queue se crea lazy una vez que confirmamos que Redis está arriba —
// instanciarla con BullMQ sin Redis disponible inunda los logs con errores.
let scanQueueRef = null;
let workerRef = null;
let mode = 'unknown'; // 'queued' | 'inline' | 'unknown'

function getOrCreateQueue() {
  if (scanQueueRef) return scanQueueRef;
  scanQueueRef = new Queue(QUEUE_NAME, {
    connection: buildConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
      attempts: 1,
    },
  });
  scanQueueRef.on('error', (err) => {
    console.error('[scan.queue] error:', err.message);
  });
  return scanQueueRef;
}

export function getMode() {
  return mode;
}

/** Pinga Redis con un timeout corto. */
async function probeRedis(timeoutMs = 1_500) {
  const { hostname, port } = new URL(REDIS_URL);
  const target = port ? Number(port) : 6379;
  return new Promise((resolve) => {
    // Usar net.connect en vez de un cliente Redis full para no agregar deps.
    import('node:net').then(({ Socket }) => {
      const socket = new Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.end();
        resolve(true);
      });
      socket.once('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      socket.connect(target, hostname);
    });
  });
}

/**
 * Encola un scan. Si Redis está disponible, usa BullMQ; si no, procesa inline
 * (fire-and-forget en el mismo proceso Express).
 */
export async function enqueueScan(scanId) {
  if (mode === 'queued') {
    return getOrCreateQueue().add('run-scan', { scanId }, { jobId: `scan-${scanId}` });
  }
  // Inline: lanzar processScan en el siguiente tick para que el endpoint
  // responda primero al cliente.
  setImmediate(() => {
    processScan(scanId).catch((err) => {
      console.error(`[scan.queue] inline scan ${scanId} falló:`, err);
    });
  });
  return { jobId: `inline-${scanId}` };
}

export async function startScanWorker() {
  if (workerRef || mode === 'inline') return workerRef;

  const redisUp = await probeRedis();
  if (!redisUp) {
    mode = 'inline';
    console.warn(
      `[scan.queue] Redis no responde en ${REDIS_URL} → modo INLINE activado. ` +
        'Los scans se procesan en el proceso Express (sin queue). ' +
        'Levantá Redis y reiniciá el backend para usar BullMQ.',
    );
    return null;
  }

  mode = 'queued';
  const queue = getOrCreateQueue();
  void queue; // garantiza que esté inicializada antes del worker
  workerRef = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { scanId } = job.data;
      await processScan(scanId);
    },
    {
      connection: buildConnection(),
      concurrency: DEFAULTS.MAX_CONCURRENT_SCANS,
    },
  );
  workerRef.on('error', (err) => {
    console.error('[scan.worker] error:', err.message);
  });
  workerRef.on('failed', (job, err) => {
    console.error(`[scan.worker] job ${job?.id} failed:`, err?.message);
  });
  console.log(
    `[scan.queue] BullMQ worker iniciado (concurrency=${DEFAULTS.MAX_CONCURRENT_SCANS}, redis=${REDIS_URL})`,
  );
  return workerRef;
}


/** Lee la flag de cancelación desde la DB. Si está seteada, abortamos. */
async function isCancelled(scanId) {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    select: { cancelRequestedAt: true, status: true },
  });
  return Boolean(scan?.cancelRequestedAt) || scan?.status === SCAN_STATUS.CANCELLED;
}

export class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelado por el usuario');
    this.name = 'ScanCancelledError';
  }
}

/**
 * Contexto compartido por todos los runners de un scan. Permite cancelación
 * agresiva mid-flight: el watcher hace polling de cancelRequestedAt en DB
 * cada 1.5s; cuando detecta cancel, dispara abort() + ejecuta cleanups
 * (ej. browser.close()) para cortar runners bloqueados.
 */
export class ScanContext {
  constructor(scanId) {
    this.scanId = scanId;
    this.controller = new AbortController();
    this.cleanups = [];
    this.pollerId = null;
    this.cancelled = false;
  }
  get signal() {
    return this.controller.signal;
  }
  registerCleanup(fn) {
    this.cleanups.push(fn);
  }
  startPolling() {
    if (this.pollerId) return;
    this.pollerId = setInterval(async () => {
      try {
        if (await isCancelled(this.scanId)) {
          await this.forceCancel();
        }
      } catch (err) {
        console.error(`[scan.queue] watcher error scan=${this.scanId}:`, err.message);
      }
    }, 1500);
  }
  stopPolling() {
    if (this.pollerId) clearInterval(this.pollerId);
    this.pollerId = null;
  }
  async forceCancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.stopPolling();
    console.log(`[scan.queue] Forzando cancelación de scan ${this.scanId}`);
    try {
      this.controller.abort(new ScanCancelledError());
    } catch {}
    const fns = this.cleanups.slice().reverse();
    this.cleanups = [];
    for (const fn of fns) {
      try {
        await fn();
      } catch (err) {
        console.error(`[scan.queue] cleanup error scan=${this.scanId}:`, err?.message);
      }
    }
  }
}

async function checkCancellation(ctx) {
  if (ctx.cancelled || ctx.signal.aborted) throw new ScanCancelledError();
  if (await isCancelled(ctx.scanId)) {
    await ctx.forceCancel();
    throw new ScanCancelledError();
  }
}

/**
 * Pipeline de scan. Cada paso es independiente; un fallo se persiste como
 * Result `fail` y el pipeline continúa.
 */
async function processScan(scanId) {
  const scan = await prisma.scan.findUnique({ where: { id: scanId } });
  if (!scan) {
    console.warn(`[scan.queue] Scan ${scanId} no existe`);
    return;
  }

  const ctx = new ScanContext(scanId);
  const totalStart = Date.now();
  const stageTimes = {};

  async function timed(name, fn) {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      const ms = Date.now() - start;
      stageTimes[name] = ms;
      console.log(`[scan.queue] scan=${scanId} stage=${name} duration=${ms}ms`);
    }
  }

  try {
    await checkCancellation(ctx);
    await updateScanStatus(scanId, SCAN_STATUS.RUNNING, { startedAt: new Date() });
    emitProgress(scanId, { stage: SCAN_STAGE.QUEUED, message: 'Iniciando scan' });
    ctx.startPolling();

    // ─── 1) Playwright: captura DOM/screenshot/links/forms/meta ──
    const pwResult = await timed('playwright.capture', () =>
      safeRun(() =>
        runPlaywrightCapture({
          url: scan.url,
          scanCtx: ctx,
          deviceProfile: scan.deviceProfile,
          onStage: (stage) =>
            emitProgress(scanId, { stage, message: `Playwright: ${stage}` }),
        }),
      ),
    );
    await persistResult(scanId, {
      category: TEST_CATEGORY.FUNCTIONAL,
      testName: 'playwright.capture',
      status: pwResult.status,
      details: pwResult.error ? { error: pwResult.error } : pwResult.data,
    });
    const captureData = pwResult.status === RESULT_STATUS.FAIL ? null : pwResult.data;

    // ─── 2) Headers de seguridad ─────────────────────────────────
    await checkCancellation(ctx);
    emitStage(scanId, SCAN_STAGE.ANALYZING_HEADERS, 'Analizando HTTP headers');
    const headersResult = await timed('headers', () =>
      safeRun(() => runHeadersCheck({ url: scan.url, scanCtx: ctx })),
    );
    await persistResult(scanId, {
      category: TEST_CATEGORY.SECURITY,
      testName: 'security.headers',
      status: headersResult.status,
      details: headersResult.error ? { error: headersResult.error } : headersResult.data,
    });
    const headersData = headersResult.error ? null : headersResult.data;

    // ─── 3) SSL/TLS ──────────────────────────────────────────────
    await checkCancellation(ctx);
    emitStage(scanId, SCAN_STAGE.ANALYZING_SSL, 'Verificando certificado SSL');
    const sslResult = await timed('ssl', () =>
      safeRun(() => runSslCheck({ url: scan.url, scanCtx: ctx })),
    );
    await persistResult(scanId, {
      category: TEST_CATEGORY.SECURITY,
      testName: 'security.ssl',
      status: sslResult.status,
      score: sslResult.data?.daysRemaining ?? null,
      details: sslResult.error ? { error: sslResult.error } : sslResult.data,
    });
    const sslData = sslResult.error ? null : sslResult.data;

    // ─── 4) SEO analyzer (sobre captureData) ─────────────────────
    await checkCancellation(ctx);
    if (captureData) {
      emitStage(scanId, SCAN_STAGE.ANALYZING_SEO, 'Analizando SEO');
      const seoResult = await timed('seo', () =>
        safeRun(async () => analyzeSeo({ captureData })),
      );
      await persistResult(scanId, {
        category: TEST_CATEGORY.SEO,
        testName: 'seo.analyzer',
        status: seoResult.status,
        score: seoResult.data?.score ?? null,
        details: seoResult.error ? { error: seoResult.error } : seoResult.data,
      });
    }

    // ─── 5) Forms analyzer ───────────────────────────────────────
    if (captureData) {
      const formsResult = await timed('forms', () =>
        safeRun(async () => analyzeForms({ captureData, baseUrl: scan.url })),
      );
      await persistResult(scanId, {
        category: TEST_CATEGORY.FUNCTIONAL,
        testName: 'forms.analyzer',
        status: formsResult.status,
        details: formsResult.error ? { error: formsResult.error } : formsResult.data,
      });
    }

    // ─── 6) Links analyzer (HEAD a cada link) ────────────────────
    await checkCancellation(ctx);
    if (captureData) {
      emitStage(scanId, SCAN_STAGE.CHECKING_LINKS, 'Verificando links');
      const linksResult = await timed('links', () =>
        safeRun(() => analyzeLinks({ captureData, baseUrl: scan.url, scanCtx: ctx })),
      );
      await persistResult(scanId, {
        category: TEST_CATEGORY.FUNCTIONAL,
        testName: 'links.analyzer',
        status: linksResult.status,
        details: linksResult.error ? { error: linksResult.error } : linksResult.data,
      });
    }

    // ─── 7) Security analyzer (score combinado) ──────────────────
    const securityResult = await timed('security.score', () =>
      safeRun(async () => analyzeSecurity({ url: scan.url, headersData, sslData })),
    );
    await persistResult(scanId, {
      category: TEST_CATEGORY.SECURITY,
      testName: 'security.score',
      status: securityResult.status,
      score: securityResult.data?.score ?? null,
      details: securityResult.error ? { error: securityResult.error } : securityResult.data,
    });

    // ─── 8) Accessibility (axe-core) ─────────────────────────────
    await checkCancellation(ctx);
    emitStage(scanId, SCAN_STAGE.ANALYZING_ACCESSIBILITY, 'Analizando accesibilidad (axe-core)');
    const a11yResult = await timed('accessibility', () =>
      safeRun(() =>
        runAccessibilityCheck({
          url: scan.url,
          scanCtx: ctx,
          deviceProfile: scan.deviceProfile,
        }),
      ),
    );
    await persistResult(scanId, {
      category: TEST_CATEGORY.ACCESSIBILITY,
      testName: 'accessibility.axe',
      status: a11yResult.status,
      score: a11yResult.data?.score ?? null,
      details: a11yResult.error ? { error: a11yResult.error } : a11yResult.data,
    });

    // ─── 9) PageSpeed Insights ───────────────────────────────────
    await checkCancellation(ctx);
    emitStage(scanId, SCAN_STAGE.ANALYZING_PERFORMANCE, 'Consultando PageSpeed Insights');
    const psResult = await timed('pagespeed', () =>
      safeRun(() =>
        runPageSpeedCheck({
          url: scan.url,
          scanCtx: ctx,
          deviceProfile: scan.deviceProfile,
        }),
      ),
    );
    await persistResult(scanId, {
      category: TEST_CATEGORY.PERFORMANCE,
      testName: 'performance.pagespeed',
      status: psResult.status,
      score: psResult.data?.scores?.performance ?? null,
      details: psResult.error ? { error: psResult.error } : psResult.data,
    });

    // ─── Cierre ──────────────────────────────────────────────────
    await checkCancellation(ctx);
    await updateScanStatus(scanId, SCAN_STATUS.COMPLETED, {
      completedAt: new Date(),
      stage: SCAN_STAGE.COMPLETED,
    });
    const summary = await buildSummary(scanId);
    emitProgress(scanId, { stage: SCAN_STAGE.COMPLETED, message: 'Scan completado' });
    emitCompleted(scanId, summary);
    console.log(
      `[scan.queue] scan=${scanId} TOTAL=${Date.now() - totalStart}ms stages=${JSON.stringify(stageTimes)}`,
    );
  } catch (err) {
    if (err instanceof ScanCancelledError || err?.name === 'AbortError') {
      console.log(`[scan.queue] Scan ${scanId} cancelado por el usuario`);
      await updateScanStatus(scanId, SCAN_STATUS.CANCELLED, {
        completedAt: new Date(),
        stage: SCAN_STAGE.COMPLETED,
      });
      emitProgress(scanId, { stage: 'cancelled', message: 'Scan cancelado' });
      emitFailed(scanId, 'Scan cancelado por el usuario');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scan.queue] Scan ${scanId} falló:`, err);
    await updateScanStatus(scanId, SCAN_STATUS.FAILED, {
      completedAt: new Date(),
      errorMessage: message,
    });
    emitFailed(scanId, message);
  } finally {
    ctx.stopPolling();
  }
}

/** Wrapper para runners/analyzers: nunca propaga excepción, devuelve {status,fail,error}. */
async function safeRun(fn) {
  try {
    const result = await fn();
    if (result && typeof result === 'object' && 'status' in result) return result;
    return { status: RESULT_STATUS.INFO, data: result, error: null };
  } catch (err) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function emitStage(scanId, stage, message) {
  emitProgress(scanId, { stage, message });
}

async function persistResult(scanId, payload) {
  const created = await prisma.result.create({
    data: {
      scanId,
      category: payload.category,
      testName: payload.testName,
      status: payload.status,
      score: payload.score ?? null,
      details: serializeDetails(payload.details),
    },
  });
  const lightDetails = stripHeavyFields(payload.details);
  emitResult(scanId, {
    id: created.id,
    category: created.category,
    testName: created.testName,
    status: created.status,
    score: created.score,
    details: lightDetails,
  });
}

/**
 * Quita campos pesados antes de enviar por Socket.io (siguen en la DB).
 * Aplica a html, screenshot, headersAll, axe violations completas, etc.
 */
function stripHeavyFields(details) {
  if (!details || typeof details !== 'object') return details;
  const { html, screenshot, headersAll, ...rest } = details;
  const omitted = [];
  if (html) omitted.push('html');
  if (screenshot) omitted.push('screenshot');
  if (headersAll) omitted.push('headersAll');
  return omitted.length > 0 ? { ...rest, _omitted: omitted } : rest;
}

async function updateScanStatus(scanId, status, extra = {}) {
  await prisma.scan.update({
    where: { id: scanId },
    data: { status, ...extra },
  });
}

async function buildSummary(scanId) {
  const results = await prisma.result.findMany({
    where: { scanId },
    select: { category: true, status: true, score: true },
  });
  const total = results.length;
  const passed = results.filter((r) => r.status === RESULT_STATUS.PASS).length;
  const failed = results.filter((r) => r.status === RESULT_STATUS.FAIL).length;
  const warnings = results.filter((r) => r.status === RESULT_STATUS.WARNING).length;

  // Promedio de score por categoría (solo donde haya score).
  const byCategory = {};
  for (const cat of Object.values(TEST_CATEGORY)) {
    const scored = results.filter((r) => r.category === cat && typeof r.score === 'number');
    if (scored.length > 0) {
      byCategory[cat] = Math.round(
        scored.reduce((sum, r) => sum + r.score, 0) / scored.length,
      );
    }
  }

  return { total, passed, failed, warnings, byCategory };
}
