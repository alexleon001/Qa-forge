// BullMQ queue para corridas del Native Runner (#15). Espejo de flow.queue.js:
// encola (inline si Redis está caído), carga el NativeFlow + provider (descifra
// el accessKey), corre el flujo vía Appium, emite progreso por Socket.io y
// persiste el resultado en NativeFlowRun.

import { Queue, Worker } from 'bullmq';

import { decrypt } from '../auth/crypto.js';
import { prisma } from '../db/client.js';
import { runNativeFlow } from '../runners/native.runner.js';
import { NATIVE_QUEUE_NAME, FLOW_RUN_STATUS } from '../../../shared/constants.js';
import {
  emitNativeCompleted,
  emitNativeFailed,
  emitNativeProgress,
  emitNativeStep,
} from '../sockets/scan.socket.js';

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
  queueRef = new Queue(NATIVE_QUEUE_NAME, {
    connection: buildConnection(),
    defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 }, attempts: 1 },
  });
  queueRef.on('error', (err) => console.error('[native.queue] error:', err.message));
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

export async function enqueueNativeFlowRun(runId) {
  if (mode === 'queued') {
    return getOrCreateQueue().add('run-native', { runId }, { jobId: `native-${runId}` });
  }
  setImmediate(() => {
    processNativeFlowRun(runId).catch((err) => console.error(`[native.queue] inline run ${runId} falló:`, err));
  });
  return { jobId: `inline-${runId}` };
}

export async function startNativeWorker() {
  if (workerRef || mode === 'inline') return workerRef;
  const redisUp = await probeRedis();
  if (!redisUp) {
    mode = 'inline';
    console.warn(`[native.queue] Redis no responde en ${REDIS_URL} → modo INLINE.`);
    return null;
  }
  mode = 'queued';
  getOrCreateQueue();
  workerRef = new Worker(
    NATIVE_QUEUE_NAME,
    async (job) => {
      await processNativeFlowRun(job.data.runId);
    },
    { connection: buildConnection(), concurrency: 1 },
  );
  workerRef.on('error', (err) => console.error('[native.worker] error:', err.message));
  workerRef.on('failed', (job, err) => console.error(`[native.worker] job ${job?.id} failed:`, err?.message));
  console.log(`[native.queue] BullMQ worker iniciado (redis=${REDIS_URL})`);
  return workerRef;
}

class NativeCancelledError extends Error {
  constructor() {
    super('Corrida native cancelada por el usuario');
    this.name = 'NativeCancelledError';
  }
}

async function isCancelled(runId) {
  const r = await prisma.nativeFlowRun.findUnique({
    where: { id: runId },
    select: { cancelRequestedAt: true, status: true },
  });
  return Boolean(r?.cancelRequestedAt) || r?.status === FLOW_RUN_STATUS.CANCELLED;
}

class NativeContext {
  constructor(runId) {
    this.runId = runId;
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
        if (await isCancelled(this.runId)) await this.forceCancel();
      } catch (err) {
        console.error(`[native.queue] watcher error run=${this.runId}:`, err.message);
      }
    }, 1500);
  }
  stopPolling() {
    if (this.pollerId) clearInterval(this.pollerId);
    this.pollerId = null;
  }
  async checkCancellation() {
    if (this.cancelled || this.signal.aborted) throw new NativeCancelledError();
    if (await isCancelled(this.runId)) {
      await this.forceCancel();
      throw new NativeCancelledError();
    }
  }
  async forceCancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.stopPolling();
    try {
      this.controller.abort(new NativeCancelledError());
    } catch {}
    const fns = this.cleanups.slice().reverse();
    this.cleanups = [];
    for (const fn of fns) {
      try {
        await fn();
      } catch (err) {
        console.error(`[native.queue] cleanup error run=${this.runId}:`, err?.message);
      }
    }
  }
}

async function processNativeFlowRun(runId) {
  const run = await prisma.nativeFlowRun.findUnique({
    where: { id: runId },
    include: { nativeFlow: { include: { provider: true } } },
  });
  if (!run) {
    console.warn(`[native.queue] NativeFlowRun ${runId} no existe`);
    return;
  }
  const flow = run.nativeFlow;
  const provider = flow?.provider;
  if (!flow || !provider) {
    await prisma.nativeFlowRun
      .update({ where: { id: runId }, data: { status: FLOW_RUN_STATUS.ERROR, completedAt: new Date(), errorMessage: 'Flow o provider no encontrado' } })
      .catch(() => {});
    return;
  }

  // Descifra el accessKey del cloud (si aplica).
  let accessKey = null;
  if (provider.encryptedAccessKey) {
    try {
      accessKey = decrypt(provider.encryptedAccessKey);
    } catch (err) {
      await prisma.nativeFlowRun
        .update({ where: { id: runId }, data: { status: FLOW_RUN_STATUS.ERROR, completedAt: new Date(), errorMessage: `No se pudo descifrar el accessKey: ${err.message}` } })
        .catch(() => {});
      return;
    }
  }

  const ctx = new NativeContext(runId);
  try {
    await ctx.checkCancellation();
    await prisma.nativeFlowRun.update({ where: { id: runId }, data: { status: FLOW_RUN_STATUS.RUNNING, startedAt: new Date() } });
    emitNativeProgress(runId, { message: 'Iniciando corrida native' });
    ctx.startPolling();

    const result = await runNativeFlow({
      flow,
      provider,
      accessKey,
      ctx,
      onStep: (step) => emitNativeStep(runId, step),
      onProgress: (p) => emitNativeProgress(runId, p),
    });

    await ctx.checkCancellation();
    await prisma.nativeFlowRun.update({
      where: { id: runId },
      data: {
        status: result.status,
        completedAt: new Date(),
        stepResults: result.stepResults,
        summary: result.summary,
        sessionId: result.sessionId ?? null,
        errorMessage: result.errorMessage ?? null,
      },
    });
    emitNativeProgress(runId, { message: 'Corrida finalizada' });
    emitNativeCompleted(runId, { status: result.status, summary: result.summary });
  } catch (err) {
    if (err instanceof NativeCancelledError || err?.name === 'AbortError') {
      await prisma.nativeFlowRun
        .update({ where: { id: runId }, data: { status: FLOW_RUN_STATUS.CANCELLED, completedAt: new Date() } })
        .catch(() => {});
      emitNativeFailed(runId, 'Corrida cancelada por el usuario');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[native.queue] NativeFlowRun ${runId} falló:`, err);
    await prisma.nativeFlowRun
      .update({ where: { id: runId }, data: { status: FLOW_RUN_STATUS.ERROR, completedAt: new Date(), errorMessage: message } })
      .catch(() => {});
    emitNativeFailed(runId, message);
  } finally {
    ctx.stopPolling();
  }
}
