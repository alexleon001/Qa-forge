// Rutas del Flow Runner determinista. Un Flow es un flujo e2e repetible
// (definición); cada ejecución es un FlowRun encolado al worker (flow.queue).
// Todo scoped al usuario autenticado.

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { computeNextRunAt } from '../../schedules/cron.master.js';
import { encrypt } from '../../auth/crypto.js';
import { enqueueFlowRun } from '../../queue/flow.queue.js';
import { exportFlow } from '../../generators/flow.export.js';
import { flowDraftFromExploration } from '../../generators/flow.import.js';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import {
  BROWSER_ENGINES,
  DEFAULT_BROWSER_ENGINE,
  DEFAULT_DEVICE_PROFILE,
  DEVICE_PROFILES,
  FLOW_ACTION_META,
  FLOW_NOTIFY_ON,
  FLOW_RUN_STATUS,
  FLOW_SOURCE,
  MAX_FLOW_STEPS,
  SCRIPT_FRAMEWORK,
} from '../../../../shared/constants.js';

export const flowRouter = Router();
flowRouter.use(requireAuth);

const urlSchema = z
  .string()
  .trim()
  .min(1, 'url requerido')
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'url debe ser http(s) válida');

const loginConfigSchema = z
  .object({
    url: urlSchema,
    usernameSelector: z.string().trim().min(1).max(500),
    passwordSelector: z.string().trim().min(1).max(500),
    username: z.string().min(1).max(500),
    password: z.string().min(1).max(500),
    submitSelector: z.string().trim().min(1).max(500),
    postLoginUrl: z.string().trim().optional(),
    waitForSelector: z.string().trim().max(500).optional(),
  })
  .strict();

const stepSchema = z
  .object({
    action: z.enum(Object.keys(FLOW_ACTION_META)),
    selector: z.string().trim().max(1_000).optional().nullable(),
    value: z.string().max(5_000).optional().nullable(),
    description: z.string().trim().max(500).optional().nullable(),
  })
  .strict()
  .superRefine((step, ctx) => {
    const meta = FLOW_ACTION_META[step.action];
    if (!meta) return;
    if (meta.needsSelector && !step.selector?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `La acción "${step.action}" requiere un selector` });
    }
    if (meta.needsValue && !(step.value ?? '').toString().trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `La acción "${step.action}" requiere un valor` });
    }
  });

const createSchema = z.object({
  name: z.string().trim().min(1, 'name requerido').max(200),
  description: z.string().trim().max(2_000).optional().nullable(),
  url: urlSchema,
  deviceProfile: z.enum(Object.keys(DEVICE_PROFILES)).optional().nullable(),
  browserEngine: z.enum(Object.keys(BROWSER_ENGINES)).optional().nullable(),
  continueOnError: z.boolean().optional(),
  source: z.enum(Object.values(FLOW_SOURCE)).optional(),
  sutId: z.string().trim().max(60).optional().nullable(),
  steps: z.array(stepSchema).min(1, 'al menos 1 paso').max(MAX_FLOW_STEPS),
  loginConfig: loginConfigSchema.optional().nullable(),
});

const updateSchema = createSchema.partial();

/** Cifra la password del loginConfig (si vino) al shape almacenable. */
function buildStoredLoginConfig(loginConfig) {
  if (!loginConfig) return undefined;
  try {
    return {
      url: loginConfig.url,
      usernameSelector: loginConfig.usernameSelector,
      passwordSelector: loginConfig.passwordSelector,
      username: loginConfig.username,
      encryptedPassword: encrypt(loginConfig.password),
      submitSelector: loginConfig.submitSelector,
      postLoginUrl: loginConfig.postLoginUrl || undefined,
      waitForSelector: loginConfig.waitForSelector || undefined,
    };
  } catch (err) {
    throw new HttpError(500, 'ENCRYPTION_FAILED', `No se pudo cifrar la password de login: ${err.message}`);
  }
}

/** Quita la password cifrada antes de devolver el flow al frontend. */
function sanitizeFlow(flow) {
  if (!flow) return flow;
  let loginConfig = null;
  if (flow.loginConfig && typeof flow.loginConfig === 'object') {
    const { encryptedPassword, ...rest } = flow.loginConfig;
    loginConfig = { ...rest, hasPassword: Boolean(encryptedPassword) };
  }
  return { ...flow, loginConfig };
}

/** Carga el flow del user o lanza 404. */
async function loadOwnedFlow(flowId, userId, extra = {}) {
  const flow = await prisma.flow.findUnique({ where: { id: flowId }, ...extra });
  if (!flow || flow.userId !== userId) {
    throw new HttpError(404, 'FLOW_NOT_FOUND', 'Flujo no encontrado');
  }
  return flow;
}

// ─── Crear / listar flows ────────────────────────────────────────────────────

flowRouter.post('/', async (req, res, next) => {
  try {
    const parse = createSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const d = parse.data;
    const flow = await prisma.flow.create({
      data: {
        userId: req.user.id,
        name: d.name,
        description: d.description ?? null,
        url: d.url,
        deviceProfile: d.deviceProfile ?? DEFAULT_DEVICE_PROFILE,
        browserEngine: d.browserEngine ?? DEFAULT_BROWSER_ENGINE,
        continueOnError: d.continueOnError ?? false,
        source: d.source ?? FLOW_SOURCE.MANUAL,
        sutId: d.sutId ?? null,
        steps: d.steps,
        loginConfig: buildStoredLoginConfig(d.loginConfig) ?? undefined,
      },
    });
    res.status(201).json({ flow: sanitizeFlow(flow) });
  } catch (err) {
    next(err);
  }
});

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

flowRouter.get('/', async (req, res, next) => {
  try {
    const parse = listQuerySchema.safeParse(req.query ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Query inválida');
    }
    const page = parse.data.page ?? 1;
    const pageSize = parse.data.pageSize ?? DEFAULT_PAGE_SIZE;
    const where = { userId: req.user.id };

    const [total, flows] = await prisma.$transaction([
      prisma.flow.count({ where }),
      prisma.flow.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          url: true,
          deviceProfile: true,
          browserEngine: true,
          steps: true,
          createdAt: true,
          updatedAt: true,
          runs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, summary: true, completedAt: true },
          },
        },
      }),
    ]);
    // No serializar los pasos completos en la lista: solo el conteo.
    const slim = flows.map((f) => ({
      ...f,
      stepCount: Array.isArray(f.steps) ? f.steps.length : 0,
      steps: undefined,
      lastRun: f.runs[0] ?? null,
      runs: undefined,
    }));
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    res.json({ flows: slim, pagination: { page, pageSize, total, totalPages, hasMore: page < totalPages } });
  } catch (err) {
    next(err);
  }
});

// ─── Importar un flow borrador desde una sesión exploratoria (v2) ────────────

flowRouter.post('/from-exploration/:sessionId', async (req, res, next) => {
  try {
    const session = await prisma.exploratorySession.findUnique({ where: { id: req.params.sessionId } });
    if (!session || session.userId !== req.user.id) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', 'Sesión exploratoria no encontrada');
    }
    const draft = flowDraftFromExploration(session);
    if (draft.steps.length === 0) {
      throw new HttpError(409, 'NO_STEPS', 'La sesión no tiene pasos convertibles a un flujo');
    }
    const flow = await prisma.flow.create({
      data: {
        userId: req.user.id,
        name: draft.name,
        description: draft.description,
        url: draft.url,
        deviceProfile: draft.deviceProfile,
        browserEngine: draft.browserEngine,
        source: draft.source,
        steps: draft.steps,
      },
    });
    res.status(201).json({ flow: sanitizeFlow(flow) });
  } catch (err) {
    next(err);
  }
});

// ─── Programación de flows via cron (v2) ─────────────────────────────────────

const flowScheduleSchema = z.object({
  flowId: z.string().trim().min(1, 'flowId requerido'),
  name: z.string().trim().min(1, 'name requerido').max(200),
  cron: z.string().trim().min(1, 'cron requerido').max(120),
  timezone: z.string().trim().max(60).optional(),
  enabled: z.boolean().optional(),
  notifyWebhook: z.string().trim().max(500).optional().nullable(),
  notifyEmail: z.string().trim().email('email inválido').max(200).optional().nullable(),
  notifyOn: z.enum(FLOW_NOTIFY_ON).optional(),
});

flowRouter.get('/schedules', async (req, res, next) => {
  try {
    const schedules = await prisma.scheduledFlow.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { flow: { select: { id: true, name: true, url: true } } },
    });
    res.json({ schedules });
  } catch (err) {
    next(err);
  }
});

flowRouter.post('/schedules', async (req, res, next) => {
  try {
    const parse = flowScheduleSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const d = parse.data;
    // El flow debe ser del usuario.
    await loadOwnedFlow(d.flowId, req.user.id);
    const timezone = d.timezone || 'UTC';
    let nextRunAt;
    try {
      nextRunAt = computeNextRunAt(d.cron, timezone, new Date());
    } catch (err) {
      throw new HttpError(400, 'INVALID_CRON', `Expresión cron inválida: ${err.message}`);
    }
    const schedule = await prisma.scheduledFlow.create({
      data: {
        userId: req.user.id,
        flowId: d.flowId,
        name: d.name,
        cron: d.cron,
        timezone,
        enabled: d.enabled ?? true,
        notifyWebhook: d.notifyWebhook || null,
        notifyEmail: d.notifyEmail || null,
        notifyOn: d.notifyOn ?? 'onFailOnly',
        nextRunAt,
      },
    });
    res.status(201).json({ schedule });
  } catch (err) {
    next(err);
  }
});

async function loadOwnedSchedule(scheduleId, userId) {
  const schedule = await prisma.scheduledFlow.findUnique({ where: { id: scheduleId } });
  if (!schedule || schedule.userId !== userId) {
    throw new HttpError(404, 'SCHEDULE_NOT_FOUND', 'Schedule no encontrado');
  }
  return schedule;
}

flowRouter.patch('/schedules/:scheduleId', async (req, res, next) => {
  try {
    const existing = await loadOwnedSchedule(req.params.scheduleId, req.user.id);
    const parse = flowScheduleSchema.partial().safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const d = parse.data;
    const data = {};
    for (const k of ['name', 'enabled', 'notifyOn']) if (d[k] !== undefined) data[k] = d[k];
    if (d.notifyWebhook !== undefined) data.notifyWebhook = d.notifyWebhook || null;
    if (d.notifyEmail !== undefined) data.notifyEmail = d.notifyEmail || null;
    // Si cambia cron/timezone, recomputar nextRunAt.
    const cron = d.cron ?? existing.cron;
    const timezone = d.timezone ?? existing.timezone;
    if (d.cron !== undefined || d.timezone !== undefined) {
      try {
        data.nextRunAt = computeNextRunAt(cron, timezone, new Date());
      } catch (err) {
        throw new HttpError(400, 'INVALID_CRON', `Expresión cron inválida: ${err.message}`);
      }
      data.cron = cron;
      data.timezone = timezone;
    }
    const schedule = await prisma.scheduledFlow.update({ where: { id: req.params.scheduleId }, data });
    res.json({ schedule });
  } catch (err) {
    next(err);
  }
});

flowRouter.delete('/schedules/:scheduleId', async (req, res, next) => {
  try {
    await loadOwnedSchedule(req.params.scheduleId, req.user.id);
    await prisma.scheduledFlow.delete({ where: { id: req.params.scheduleId } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

flowRouter.post('/schedules/:scheduleId/run', async (req, res, next) => {
  try {
    const schedule = await loadOwnedSchedule(req.params.scheduleId, req.user.id);
    const run = await prisma.flowRun.create({
      data: { flowId: schedule.flowId, status: FLOW_RUN_STATUS.PENDING, scheduledFlowId: schedule.id },
    });
    await prisma.scheduledFlow.update({ where: { id: schedule.id }, data: { lastRunAt: new Date(), lastRunId: run.id } });
    await enqueueFlowRun(run.id);
    res.status(201).json({ run });
  } catch (err) {
    next(err);
  }
});

// ─── Detalle de una corrida (debe ir ANTES de /:id para no colisionar) ───────

flowRouter.get('/runs/:runId', async (req, res, next) => {
  try {
    const run = await prisma.flowRun.findUnique({
      where: { id: req.params.runId },
      include: { flow: { select: { id: true, name: true, url: true, userId: true } } },
    });
    if (!run || run.flow?.userId !== req.user.id) {
      throw new HttpError(404, 'RUN_NOT_FOUND', 'Corrida no encontrada');
    }
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

flowRouter.post('/runs/:runId/cancel', async (req, res, next) => {
  try {
    const run = await prisma.flowRun.findUnique({
      where: { id: req.params.runId },
      include: { flow: { select: { userId: true } } },
    });
    if (!run || run.flow?.userId !== req.user.id) {
      throw new HttpError(404, 'RUN_NOT_FOUND', 'Corrida no encontrada');
    }
    if ([FLOW_RUN_STATUS.PASSED, FLOW_RUN_STATUS.FAILED, FLOW_RUN_STATUS.ERROR, FLOW_RUN_STATUS.CANCELLED].includes(run.status)) {
      throw new HttpError(409, 'RUN_FINISHED', 'La corrida ya terminó');
    }
    const updated = await prisma.flowRun.update({
      where: { id: req.params.runId },
      data: { cancelRequestedAt: new Date() },
      select: { id: true, status: true, cancelRequestedAt: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── Detalle / update / delete de un flow ────────────────────────────────────

flowRouter.get('/:id', async (req, res, next) => {
  try {
    const flow = await loadOwnedFlow(req.params.id, req.user.id, {
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, status: true, summary: true, createdAt: true, completedAt: true, errorMessage: true },
        },
      },
    });
    const { runs, ...rest } = flow;
    res.json({ flow: sanitizeFlow(rest), runs });
  } catch (err) {
    next(err);
  }
});

flowRouter.put('/:id', async (req, res, next) => {
  try {
    await loadOwnedFlow(req.params.id, req.user.id);
    const parse = updateSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const d = parse.data;
    const data = {};
    for (const k of ['name', 'description', 'url', 'deviceProfile', 'browserEngine', 'continueOnError', 'source', 'sutId', 'steps']) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    // loginConfig: null explícito = borrar; objeto = re-cifrar; ausente = no tocar.
    if (d.loginConfig === null) data.loginConfig = null;
    else if (d.loginConfig) data.loginConfig = buildStoredLoginConfig(d.loginConfig);

    const flow = await prisma.flow.update({ where: { id: req.params.id }, data });
    res.json({ flow: sanitizeFlow(flow) });
  } catch (err) {
    next(err);
  }
});

flowRouter.delete('/:id', async (req, res, next) => {
  try {
    await loadOwnedFlow(req.params.id, req.user.id);
    await prisma.flow.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ─── Lanzar una corrida ──────────────────────────────────────────────────────

flowRouter.post('/:id/run', async (req, res, next) => {
  try {
    const flow = await loadOwnedFlow(req.params.id, req.user.id);
    const run = await prisma.flowRun.create({
      data: { flowId: flow.id, status: FLOW_RUN_STATUS.PENDING },
    });
    await enqueueFlowRun(run.id);
    res.status(201).json({ run });
  } catch (err) {
    next(err);
  }
});

flowRouter.get('/:id/runs', async (req, res, next) => {
  try {
    await loadOwnedFlow(req.params.id, req.user.id);
    const runs = await prisma.flowRun.findMany({
      where: { flowId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, status: true, summary: true, createdAt: true, completedAt: true, errorMessage: true },
    });
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

// ─── Exportar a script (Playwright / Cypress / Selenium) (v2) ────────────────

flowRouter.get('/:id/export', async (req, res, next) => {
  try {
    const flow = await loadOwnedFlow(req.params.id, req.user.id);
    const framework = String(req.query.framework ?? SCRIPT_FRAMEWORK.PLAYWRIGHT);
    if (!Object.values(SCRIPT_FRAMEWORK).includes(framework)) {
      throw new HttpError(400, 'INVALID_FRAMEWORK', `Framework inválido: ${framework}`);
    }
    const result = exportFlow(flow, framework);
    res.json(result); // { content, filename, language, framework }
  } catch (err) {
    next(err);
  }
});
