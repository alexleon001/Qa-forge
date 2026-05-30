// BullMQ queue para las corridas del Flow Runner determinista. Espejo de
// explore.queue.js: encola (con fallback inline si Redis está caído), corre el
// flujo, emite progreso por Socket.io y persiste el resultado en FlowRun.

import { Queue, Worker } from 'bullmq';

import { prisma } from '../db/client.js';
import { runFlow } from '../runners/flow.runner.js';
import { notifyFlowRunComplete } from '../notify/notifier.js';
import { FLOW_QUEUE_NAME, FLOW_RUN_STATUS } from '../../../shared/constants.js';
import {
  emitFlowCompleted,
  emitFlowFailed,
  emitFlowProgress,
  emitFlowStep,
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
let mode = 'unknown'; // 'queued' | 'inline' | 'unknown'

function getOrCreateQueue() {
  if (queueRef) return queueRef;
  queueRef = new Queue(FLOW_QUEUE_NAME, {
    connection: buildConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
      attempts: 1,
    },
  });
  queueRef.on('error', (err) => console.error('[flow.queue] error:', err.message));
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

export async function enqueueFlowRun(runId) {
  if (mode === 'queued') {
    return getOrCreateQueue().add('run-flow', { runId }, { jobId: `flow-${runId}` });
  }
  setImmediate(() => {
    processFlowRun(runId).catch((err) => console.error(`[flow.queue] inline run ${runId} falló:`, err));
  });
  return { jobId: `inline-${runId}` };
}

export async function startFlowWorker() {
  if (workerRef || mode === 'inline') return workerRef;
  const redisUp = await probeRedis();
  if (!redisUp) {
    mode = 'inline';
    console.warn(`[flow.queue] Redis no responde en ${REDIS_URL} → modo INLINE.`);
    return null;
  }
  mode = 'queued';
  getOrCreateQueue();
  workerRef = new Worker(
    FLOW_QUEUE_NAME,
    async (job) => {
      await processFlowRun(job.data.runId);
    },
    { connection: buildConnection(), concurrency: 1 },
  );
  workerRef.on('error', (err) => console.error('[flow.worker] error:', err.message));
  workerRef.on('failed', (job, err) => console.error(`[flow.worker] job ${job?.id} failed:`, err?.message));
  console.log(`[flow.queue] BullMQ worker iniciado (redis=${REDIS_URL})`);
  return workerRef;
}

class FlowCancelledError extends Error {
  constructor() {
    super('Corrida cancelada por el usuario');
    this.name = 'FlowCancelledError';
  }
}

async function isCancelled(runId) {
  const r = await prisma.flowRun.findUnique({
    where: { id: runId },
    select: { cancelRequestedAt: true, status: true },
  });
  return Boolean(r?.cancelRequestedAt) || r?.status === FLOW_RUN_STATUS.CANCELLED;
}

/** Contexto de cancelación: poll de cancelRequestedAt + AbortController + cleanups. */
class FlowContext {
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
        console.error(`[flow.queue] watcher error run=${this.runId}:`, err.message);
      }
    }, 1500);
  }
  stopPolling() {
    if (this.pollerId) clearInterval(this.pollerId);
    this.pollerId = null;
  }
  async checkCancellation() {
    if (this.cancelled || this.signal.aborted) throw new FlowCancelledError();
    if (await isCancelled(this.runId)) {
      await this.forceCancel();
      throw new FlowCancelledError();
    }
  }
  async forceCancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.stopPolling();
    try {
      this.controller.abort(new FlowCancelledError());
    } catch {}
    const fns = this.cleanups.slice().reverse();
    this.cleanups = [];
    for (const fn of fns) {
      try {
        await fn();
      } catch (err) {
        console.error(`[flow.queue] cleanup error run=${this.runId}:`, err?.message);
      }
    }
  }
}

async function notifyScheduledFlowRun(scheduledFlowId, runId, result) {
  const schedule = await prisma.scheduledFlow.findUnique({
    where: { id: scheduledFlowId },
    include: { flow: { select: { url: true, name: true } } },
  });
  if (!schedule) return;
  await notifyFlowRunComplete({
    schedule,
    flow: schedule.flow,
    run: {
      id: runId,
      status: result.status,
      summary: result.summary,
      errorMessage: result.errorMessage,
      completedAt: new Date(),
    },
  });
}

async function processFlowRun(runId) {
  const run = await prisma.flowRun.findUnique({ where: { id: runId }, include: { flow: true } });
  if (!run) {
    console.warn(`[flow.queue] FlowRun ${runId} no existe`);
    return;
  }
  if (!run.flow) {
    await prisma.flowRun
      .update({ where: { id: runId }, data: { status: FLOW_RUN_STATUS.ERROR, completedAt: new Date(), errorMessage: 'Flow no encontrado' } })
      .catch(() => {});
    return;
  }

  const ctx = new FlowContext(runId);
  try {
    await ctx.checkCancellation();
    await prisma.flowRun.update({
      where: { id: runId },
      data: { status: FLOW_RUN_STATUS.RUNNING, startedAt: new Date() },
    });
    emitFlowProgress(runId, { message: 'Iniciando corrida' });
    ctx.startPolling();

    const result = await runFlow({
      flow: run.flow,
      ctx,
      onStep: (step) => emitFlowStep(runId, step),
      onProgress: (p) => emitFlowProgress(runId, p),
    });

    await ctx.checkCancellation();
    await prisma.flowRun.update({
      where: { id: runId },
      data: {
        status: result.status,
        completedAt: new Date(),
        stepResults: result.stepResults,
        summary: result.summary,
        signals: result.signals ?? null,
        errorMessage: result.errorMessage ?? null,
      },
    });
    emitFlowProgress(runId, { message: 'Corrida finalizada' });
    emitFlowCompleted(runId, { status: result.status, summary: result.summary });

    // Notificación si la corrida fue disparada por un ScheduledFlow (v2).
    if (run.scheduledFlowId) {
      await notifyScheduledFlowRun(run.scheduledFlowId, runId, result).catch((err) =>
        console.error(`[flow.queue] notify run=${runId} falló:`, err?.message),
      );
    }
  } catch (err) {
    if (err instanceof FlowCancelledError || err?.name === 'AbortError') {
      await prisma.flowRun
        .update({ where: { id: runId }, data: { status: FLOW_RUN_STATUS.CANCELLED, completedAt: new Date() } })
        .catch(() => {});
      emitFlowFailed(runId, 'Corrida cancelada por el usuario');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[flow.queue] FlowRun ${runId} falló:`, err);
    await prisma.flowRun
      .update({ where: { id: runId }, data: { status: FLOW_RUN_STATUS.ERROR, completedAt: new Date(), errorMessage: message } })
      .catch(() => {});
    emitFlowFailed(runId, message);
  } finally {
    ctx.stopPolling();
  }
}
