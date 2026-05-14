// Cron master para QA Forge — tick cada 60s. Busca ScheduledScans habilitados
// cuyo `nextRunAt` ya venció, los dispara y recalcula `nextRunAt`. No usamos
// node-cron porque queremos:
//   - persistencia: cada schedule vive en la DB (un restart no pierde estado)
//   - cancellation: al borrar/desactivar, no hay listeners colgados
//   - multi-process safe: si en el futuro escala, un solo proceso tickea
//     (con un lock de DB) — por ahora 1 proceso, basta.

import { CronExpressionParser } from 'cron-parser';

import { prisma } from '../db/client.js';
import { enqueueScan } from '../queue/scan.queue.js';
import { SCAN_STATUS } from '../../../shared/constants.js';

const TICK_INTERVAL_MS = 60_000;
const ENABLE_FLAG = process.env.ENABLE_SCHEDULER !== 'false';

let tickerHandle = null;

export function startCronMaster() {
  if (tickerHandle) return tickerHandle;
  if (!ENABLE_FLAG) {
    console.warn('[cron.master] Deshabilitado por ENABLE_SCHEDULER=false');
    return null;
  }
  // Inicializa nextRunAt de schedules que no lo tienen seteado.
  bootstrapNextRunTimes().catch((err) =>
    console.error('[cron.master] bootstrap error:', err.message),
  );
  tickerHandle = setInterval(runTick, TICK_INTERVAL_MS);
  console.log(`[cron.master] iniciado (tick cada ${TICK_INTERVAL_MS / 1000}s)`);
  // Tick inmediato al boot para no esperar 60s.
  setImmediate(() => runTick().catch(() => {}));
  return tickerHandle;
}

export function stopCronMaster() {
  if (tickerHandle) clearInterval(tickerHandle);
  tickerHandle = null;
}

async function bootstrapNextRunTimes() {
  const orphan = await prisma.scheduledScan.findMany({
    where: { enabled: true, nextRunAt: null },
    select: { id: true, cron: true, timezone: true },
  });
  for (const s of orphan) {
    try {
      const next = computeNextRunAt(s.cron, s.timezone, new Date());
      await prisma.scheduledScan.update({
        where: { id: s.id },
        data: { nextRunAt: next },
      });
    } catch (err) {
      console.error(`[cron.master] schedule ${s.id} expresión inválida:`, err.message);
    }
  }
}

async function runTick() {
  const now = new Date();
  let due;
  try {
    due = await prisma.scheduledScan.findMany({
      where: {
        enabled: true,
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      take: 20, // safeguard: no disparar 200 a la vez si la DB tiene cosas viejas
    });
  } catch (err) {
    console.error('[cron.master] tick query error:', err.message);
    return;
  }

  for (const s of due) {
    try {
      await fireSchedule(s);
    } catch (err) {
      console.error(`[cron.master] schedule ${s.id} falló:`, err.message);
      // Aún así actualizamos nextRunAt para no quedarnos atascados
      try {
        const next = computeNextRunAt(s.cron, s.timezone, new Date());
        await prisma.scheduledScan.update({
          where: { id: s.id },
          data: { nextRunAt: next },
        });
      } catch {}
    }
  }
}

async function fireSchedule(schedule) {
  const now = new Date();

  const scan = await prisma.scan.create({
    data: {
      url: schedule.url,
      status: SCAN_STATUS.PENDING,
      userId: schedule.userId,
      deviceProfile: schedule.deviceProfile,
      browserEngine: schedule.browserEngine,
      mode: schedule.mode,
      maxPages: schedule.maxPages,
      loginConfig: schedule.loginConfig ?? undefined,
      scheduledScanId: schedule.id,
    },
    select: { id: true },
  });
  await enqueueScan(scan.id);

  const nextRun = (() => {
    try {
      return computeNextRunAt(schedule.cron, schedule.timezone, now);
    } catch {
      return null;
    }
  })();

  await prisma.scheduledScan.update({
    where: { id: schedule.id },
    data: {
      lastRunAt: now,
      lastScanId: scan.id,
      nextRunAt: nextRun,
    },
  });

  console.log(
    `[cron.master] schedule=${schedule.id} (${schedule.name}) → scan=${scan.id}, next=${nextRun?.toISOString() ?? 'never'}`,
  );
}

/**
 * Calcula el próximo run para una expresión cron. Acepta timezone (IANA).
 */
export function computeNextRunAt(cronExpr, timezone, from) {
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: from ?? new Date(),
    tz: timezone || 'UTC',
  });
  return interval.next().toDate();
}

/**
 * Valida una expresión cron sin consumirla. Devuelve { valid, nextRunAt, error }.
 */
export function validateCron(cronExpr, timezone) {
  try {
    const next = computeNextRunAt(cronExpr, timezone, new Date());
    return { valid: true, nextRunAt: next, error: null };
  } catch (err) {
    return { valid: false, nextRunAt: null, error: err.message };
  }
}
