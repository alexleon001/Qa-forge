// BullMQ queue para las sesiones de AI exploratory testing. Espejo acotado de
// scan.queue.js: encola (con fallback inline si Redis está caído), corre el loop
// del agente, emite progreso por Socket.io y persiste el resultado.

import { Queue, Worker } from 'bullmq';

import { prisma } from '../db/client.js';
import { runExploration } from '../agents/explore.agent.js';
import { SCAN_STATUS } from '../../../shared/constants.js';
import {
  emitExploreCompleted,
  emitExploreFailed,
  emitExploreFinding,
  emitExploreProgress,
  emitExploreStep,
} from '../sockets/scan.socket.js';

const EXPLORE_QUEUE_NAME = 'qa-forge-explore';
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
  queueRef = new Queue(EXPLORE_QUEUE_NAME, {
    connection: buildConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
      attempts: 1,
    },
  });
  queueRef.on('error', (err) => console.error('[explore.queue] error:', err.message));
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

export async function enqueueExploration(sessionId) {
  if (mode === 'queued') {
    return getOrCreateQueue().add('run-explore', { sessionId }, { jobId: `explore-${sessionId}` });
  }
  setImmediate(() => {
    processExploration(sessionId).catch((err) =>
      console.error(`[explore.queue] inline session ${sessionId} falló:`, err),
    );
  });
  return { jobId: `inline-${sessionId}` };
}

export async function startExploreWorker() {
  if (workerRef || mode === 'inline') return workerRef;
  const redisUp = await probeRedis();
  if (!redisUp) {
    mode = 'inline';
    console.warn(`[explore.queue] Redis no responde en ${REDIS_URL} → modo INLINE.`);
    return null;
  }
  mode = 'queued';
  getOrCreateQueue();
  workerRef = new Worker(
    EXPLORE_QUEUE_NAME,
    async (job) => {
      await processExploration(job.data.sessionId);
    },
    { connection: buildConnection(), concurrency: 1 },
  );
  workerRef.on('error', (err) => console.error('[explore.worker] error:', err.message));
  workerRef.on('failed', (job, err) => console.error(`[explore.worker] job ${job?.id} failed:`, err?.message));
  console.log(`[explore.queue] BullMQ worker iniciado (redis=${REDIS_URL})`);
  return workerRef;
}

class ExploreCancelledError extends Error {
  constructor() {
    super('Sesión exploratoria cancelada por el usuario');
    this.name = 'ExploreCancelledError';
  }
}

async function isCancelled(sessionId) {
  const s = await prisma.exploratorySession.findUnique({
    where: { id: sessionId },
    select: { cancelRequestedAt: true, status: true },
  });
  return Boolean(s?.cancelRequestedAt) || s?.status === SCAN_STATUS.CANCELLED;
}

/** Contexto de cancelación: poll de cancelRequestedAt + AbortController + cleanups. */
class ExploreContext {
  constructor(sessionId) {
    this.sessionId = sessionId;
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
        if (await isCancelled(this.sessionId)) await this.forceCancel();
      } catch (err) {
        console.error(`[explore.queue] watcher error session=${this.sessionId}:`, err.message);
      }
    }, 1500);
  }
  stopPolling() {
    if (this.pollerId) clearInterval(this.pollerId);
    this.pollerId = null;
  }
  async checkCancellation() {
    if (this.cancelled || this.signal.aborted) throw new ExploreCancelledError();
    if (await isCancelled(this.sessionId)) {
      await this.forceCancel();
      throw new ExploreCancelledError();
    }
  }
  async forceCancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.stopPolling();
    try {
      this.controller.abort(new ExploreCancelledError());
    } catch {}
    const fns = this.cleanups.slice().reverse();
    this.cleanups = [];
    for (const fn of fns) {
      try {
        await fn();
      } catch (err) {
        console.error(`[explore.queue] cleanup error session=${this.sessionId}:`, err?.message);
      }
    }
  }
}

async function processExploration(sessionId) {
  const session = await prisma.exploratorySession.findUnique({ where: { id: sessionId } });
  if (!session) {
    console.warn(`[explore.queue] Sesión ${sessionId} no existe`);
    return;
  }

  const ctx = new ExploreContext(sessionId);
  try {
    await ctx.checkCancellation();
    await prisma.exploratorySession.update({
      where: { id: sessionId },
      data: { status: SCAN_STATUS.RUNNING, startedAt: new Date() },
    });
    emitExploreProgress(sessionId, { message: 'Iniciando sesión exploratoria' });
    ctx.startPolling();

    const result = await runExploration({
      session,
      ctx,
      onStep: (step) => {
        emitExploreStep(sessionId, step);
        // Update liviano del progreso (no persiste el array completo todavía).
        prisma.exploratorySession
          .update({ where: { id: sessionId }, data: { currentStep: step.n } })
          .catch(() => {});
      },
      onFinding: (finding) => emitExploreFinding(sessionId, finding),
      onProgress: (p) => emitExploreProgress(sessionId, p),
    });

    await ctx.checkCancellation();
    await prisma.exploratorySession.update({
      where: { id: sessionId },
      data: {
        status: SCAN_STATUS.COMPLETED,
        completedAt: new Date(),
        steps: result.steps,
        findings: result.findings,
        summary: result.summary,
        provider: result.provider ?? null,
        model: result.model ?? null,
        currentStep: result.steps.length,
      },
    });
    emitExploreProgress(sessionId, { message: 'Sesión completada' });
    emitExploreCompleted(sessionId, result.summary);
  } catch (err) {
    if (err instanceof ExploreCancelledError || err?.name === 'AbortError') {
      await prisma.exploratorySession
        .update({ where: { id: sessionId }, data: { status: SCAN_STATUS.CANCELLED, completedAt: new Date() } })
        .catch(() => {});
      emitExploreFailed(sessionId, 'Sesión cancelada por el usuario');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[explore.queue] Sesión ${sessionId} falló:`, err);
    await prisma.exploratorySession
      .update({ where: { id: sessionId }, data: { status: SCAN_STATUS.FAILED, completedAt: new Date(), errorMessage: message } })
      .catch(() => {});
    emitExploreFailed(sessionId, message);
  } finally {
    ctx.stopPolling();
  }
}
