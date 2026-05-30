// BullMQ queue para los scans de OWASP ZAP (#14). Espejo de las otras queues:
// encola (inline si Redis está caído), carga el ZapScan + ZapConfig del usuario
// (descifra la apiKey), corre el runner ZAP, emite progreso por Socket.io y
// persiste alertas + resumen. Los scans ZAP son largos (active scan = minutos).

import { Queue, Worker } from 'bullmq';

import { decrypt } from '../auth/crypto.js';
import { prisma } from '../db/client.js';
import { runZapScan } from '../runners/zap.runner.js';
import { SCAN_STATUS, ZAP_QUEUE_NAME } from '../../../shared/constants.js';
import { emitZapCompleted, emitZapFailed, emitZapProgress } from '../sockets/scan.socket.js';

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

let queueRef = null;
let workerRef = null;
let mode = 'unknown';

function getOrCreateQueue() {
  if (queueRef) return queueRef;
  queueRef = new Queue(ZAP_QUEUE_NAME, {
    connection: buildConnection(),
    defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 }, attempts: 1 },
  });
  queueRef.on('error', (err) => console.error('[zap.queue] error:', err.message));
  return queueRef;
}

async function probeRedis(timeoutMs = 1_500) {
  const { hostname, port } = new URL(REDIS_URL);
  const target = port ? Number(port) : 6379;
  return new Promise((resolve) => {
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

export async function enqueueZapScan(scanId) {
  if (mode === 'queued') {
    return getOrCreateQueue().add('run-zap', { scanId }, { jobId: `zap-${scanId}` });
  }
  setImmediate(() => {
    processZapScan(scanId).catch((err) => console.error(`[zap.queue] inline scan ${scanId} falló:`, err));
  });
  return { jobId: `inline-${scanId}` };
}

export async function startZapWorker() {
  if (workerRef || mode === 'inline') return workerRef;
  const redisUp = await probeRedis();
  if (!redisUp) {
    mode = 'inline';
    console.warn(`[zap.queue] Redis no responde en ${REDIS_URL} → modo INLINE.`);
    return null;
  }
  mode = 'queued';
  getOrCreateQueue();
  workerRef = new Worker(
    ZAP_QUEUE_NAME,
    async (job) => {
      await processZapScan(job.data.scanId);
    },
    { connection: buildConnection(), concurrency: 1 },
  );
  workerRef.on('error', (err) => console.error('[zap.worker] error:', err.message));
  workerRef.on('failed', (job, err) => console.error(`[zap.worker] job ${job?.id} failed:`, err?.message));
  console.log(`[zap.queue] BullMQ worker iniciado (redis=${REDIS_URL})`);
  return workerRef;
}

class ZapCancelledError extends Error {
  constructor() {
    super('Scan ZAP cancelado por el usuario');
    this.name = 'ZapCancelledError';
    this.isCancellation = true;
  }
}

async function isCancelled(scanId) {
  const s = await prisma.zapScan.findUnique({ where: { id: scanId }, select: { cancelRequestedAt: true, status: true } });
  return Boolean(s?.cancelRequestedAt) || s?.status === SCAN_STATUS.CANCELLED;
}

class ZapContext {
  constructor(scanId) {
    this.scanId = scanId;
    this.controller = new AbortController();
    this.pollerId = null;
    this.cancelled = false;
  }
  get signal() {
    return this.controller.signal;
  }
  startPolling() {
    if (this.pollerId) return;
    this.pollerId = setInterval(async () => {
      try {
        if (await isCancelled(this.scanId)) {
          this.cancelled = true;
          this.stopPolling();
          try {
            this.controller.abort(new ZapCancelledError());
          } catch {}
        }
      } catch (err) {
        console.error(`[zap.queue] watcher error scan=${this.scanId}:`, err.message);
      }
    }, 2000);
  }
  stopPolling() {
    if (this.pollerId) clearInterval(this.pollerId);
    this.pollerId = null;
  }
  async checkCancellation() {
    if (this.cancelled || this.signal.aborted) throw new ZapCancelledError();
    if (await isCancelled(this.scanId)) {
      this.cancelled = true;
      throw new ZapCancelledError();
    }
  }
}

async function processZapScan(scanId) {
  const scan = await prisma.zapScan.findUnique({ where: { id: scanId } });
  if (!scan) {
    console.warn(`[zap.queue] ZapScan ${scanId} no existe`);
    return;
  }
  const cfg = await prisma.zapConfig.findUnique({ where: { userId: scan.userId } });
  if (!cfg) {
    await prisma.zapScan
      .update({ where: { id: scanId }, data: { status: SCAN_STATUS.FAILED, completedAt: new Date(), errorMessage: 'No hay config de ZAP para el usuario' } })
      .catch(() => {});
    emitZapFailed(scanId, 'No hay config de ZAP para el usuario');
    return;
  }

  let apiKey = null;
  if (cfg.encryptedApiKey) {
    try {
      apiKey = decrypt(cfg.encryptedApiKey);
    } catch {
      await prisma.zapScan
        .update({ where: { id: scanId }, data: { status: SCAN_STATUS.FAILED, completedAt: new Date(), errorMessage: 'No se pudo descifrar la apiKey de ZAP' } })
        .catch(() => {});
      emitZapFailed(scanId, 'No se pudo descifrar la apiKey de ZAP');
      return;
    }
  }

  const ctx = new ZapContext(scanId);
  try {
    await ctx.checkCancellation();
    await prisma.zapScan.update({ where: { id: scanId }, data: { status: SCAN_STATUS.RUNNING, startedAt: new Date(), phase: 'spider' } });
    emitZapProgress(scanId, { message: 'Iniciando scan ZAP', phase: 'spider' });
    ctx.startPolling();

    const result = await runZapScan({
      scan,
      config: { apiUrl: cfg.apiUrl, apiKey },
      ctx,
      onProgress: (p) => {
        emitZapProgress(scanId, p);
        // Persistencia liviana de progreso (no rompe si falla).
        const data = {};
        if (p.phase) data.phase = p.phase;
        if (typeof p.spiderProgress === 'number') data.spiderProgress = p.spiderProgress;
        if (typeof p.activeProgress === 'number') data.activeProgress = p.activeProgress;
        if (Object.keys(data).length) prisma.zapScan.update({ where: { id: scanId }, data }).catch(() => {});
      },
    });

    await ctx.checkCancellation();
    await prisma.zapScan.update({
      where: { id: scanId },
      data: {
        status: result.status,
        phase: result.phase ?? 'done',
        completedAt: new Date(),
        alerts: result.alerts,
        summary: result.summary,
        errorMessage: result.errorMessage ?? null,
      },
    });
    emitZapProgress(scanId, { message: 'Scan finalizado', phase: 'done' });
    emitZapCompleted(scanId, { status: result.status, summary: result.summary });
  } catch (err) {
    if (err instanceof ZapCancelledError || err?.isCancellation || err?.name === 'AbortError') {
      await prisma.zapScan
        .update({ where: { id: scanId }, data: { status: SCAN_STATUS.CANCELLED, completedAt: new Date() } })
        .catch(() => {});
      emitZapFailed(scanId, 'Scan cancelado por el usuario');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[zap.queue] ZapScan ${scanId} falló:`, err);
    await prisma.zapScan
      .update({ where: { id: scanId }, data: { status: SCAN_STATUS.FAILED, completedAt: new Date(), errorMessage: message } })
      .catch(() => {});
    emitZapFailed(scanId, message);
  } finally {
    ctx.stopPolling();
  }
}
