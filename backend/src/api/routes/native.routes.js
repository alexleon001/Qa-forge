// Rutas del Native app testing (#15). Dos sub-recursos bajo /api/native:
//  - /providers: endpoints Appium del usuario (local / browserstack / saucelabs),
//    con accessKey cifrado. Incluye "test connection" (GET /status del endpoint).
//  - /flows: definición de flujos native + corridas (encoladas a native.queue).
// Todo scoped al usuario autenticado.

import { Router } from 'express';
import { z } from 'zod';

import { AppiumError, getStatus, resolveEndpoint } from '../../integrations/appium.client.js';
import { HttpError } from '../middlewares/error.middleware.js';
import { decrypt, encrypt, maskKey } from '../../auth/crypto.js';
import { enqueueNativeFlowRun } from '../../queue/native.queue.js';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import {
  DEFAULT_NATIVE_PLATFORM,
  FLOW_RUN_STATUS,
  MAX_NATIVE_STEPS,
  NATIVE_ACTION_META,
  NATIVE_PLATFORMS,
  NATIVE_PROVIDER_TYPES,
} from '../../../../shared/constants.js';

export const nativeRouter = Router();
nativeRouter.use(requireAuth);

// ─── Providers (endpoints Appium) ────────────────────────────────────────────

const providerSchema = z.object({
  type: z.enum(Object.keys(NATIVE_PROVIDER_TYPES)),
  label: z.string().trim().min(1, 'label requerido').max(120),
  appiumUrl: z.string().trim().max(500).optional().nullable(),
  username: z.string().trim().max(200).optional().nullable(),
  accessKey: z.string().trim().max(500).optional().nullable(),
  region: z.string().trim().max(60).optional().nullable(),
});

function sanitizeProvider(p) {
  if (!p) return p;
  const { encryptedAccessKey, ...rest } = p;
  return { ...rest, hasAccessKey: Boolean(encryptedAccessKey) };
}

async function loadOwnedProvider(id, userId) {
  const p = await prisma.nativeProvider.findUnique({ where: { id } });
  if (!p || p.userId !== userId) throw new HttpError(404, 'PROVIDER_NOT_FOUND', 'Provider no encontrado');
  return p;
}

nativeRouter.get('/providers', async (req, res, next) => {
  try {
    const providers = await prisma.nativeProvider.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ providers: providers.map(sanitizeProvider) });
  } catch (err) {
    next(err);
  }
});

nativeRouter.post('/providers', async (req, res, next) => {
  try {
    const parse = providerSchema.safeParse(req.body ?? {});
    if (!parse.success) throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    const d = parse.data;
    if (d.type !== 'local' && (!d.username || !d.accessKey)) {
      throw new HttpError(400, 'MISSING_CREDENTIALS', 'username y accessKey requeridos para un provider cloud');
    }
    const data = {
      userId: req.user.id,
      type: d.type,
      label: d.label,
      appiumUrl: d.appiumUrl || null,
      username: d.username || null,
      region: d.region || null,
    };
    if (d.accessKey) {
      data.encryptedAccessKey = encrypt(d.accessKey);
      data.hint = maskKey(d.accessKey);
    }
    const provider = await prisma.nativeProvider.create({ data });
    res.status(201).json({ provider: sanitizeProvider(provider) });
  } catch (err) {
    next(err);
  }
});

nativeRouter.patch('/providers/:id', async (req, res, next) => {
  try {
    await loadOwnedProvider(req.params.id, req.user.id);
    const parse = providerSchema.partial().safeParse(req.body ?? {});
    if (!parse.success) throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    const d = parse.data;
    const data = {};
    for (const k of ['type', 'label']) if (d[k] !== undefined) data[k] = d[k];
    if (d.appiumUrl !== undefined) data.appiumUrl = d.appiumUrl || null;
    if (d.username !== undefined) data.username = d.username || null;
    if (d.region !== undefined) data.region = d.region || null;
    if (d.accessKey) {
      data.encryptedAccessKey = encrypt(d.accessKey);
      data.hint = maskKey(d.accessKey);
    }
    const provider = await prisma.nativeProvider.update({ where: { id: req.params.id }, data });
    res.json({ provider: sanitizeProvider(provider) });
  } catch (err) {
    next(err);
  }
});

nativeRouter.delete('/providers/:id', async (req, res, next) => {
  try {
    await loadOwnedProvider(req.params.id, req.user.id);
    await prisma.nativeProvider.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/** Test de conectividad: GET /status del endpoint Appium resuelto. */
nativeRouter.post('/providers/:id/test', async (req, res, next) => {
  try {
    const provider = await loadOwnedProvider(req.params.id, req.user.id);
    let accessKey = null;
    if (provider.encryptedAccessKey) {
      try {
        accessKey = decrypt(provider.encryptedAccessKey);
      } catch {
        throw new HttpError(500, 'DECRYPT_FAILED', 'No se pudo descifrar el accessKey');
      }
    }
    try {
      const endpoint = resolveEndpoint(provider, accessKey);
      const status = await getStatus(endpoint);
      res.json({ ok: true, status });
    } catch (err) {
      if (err instanceof AppiumError) throw new HttpError(err.status, err.code, err.message);
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// ─── Detalle / cancel de corridas (antes de /:id) ────────────────────────────

nativeRouter.get('/runs/:runId', async (req, res, next) => {
  try {
    const run = await prisma.nativeFlowRun.findUnique({
      where: { id: req.params.runId },
      include: { nativeFlow: { select: { id: true, name: true, userId: true, platform: true } } },
    });
    if (!run || run.nativeFlow?.userId !== req.user.id) {
      throw new HttpError(404, 'RUN_NOT_FOUND', 'Corrida no encontrada');
    }
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

nativeRouter.post('/runs/:runId/cancel', async (req, res, next) => {
  try {
    const run = await prisma.nativeFlowRun.findUnique({
      where: { id: req.params.runId },
      include: { nativeFlow: { select: { userId: true } } },
    });
    if (!run || run.nativeFlow?.userId !== req.user.id) {
      throw new HttpError(404, 'RUN_NOT_FOUND', 'Corrida no encontrada');
    }
    if ([FLOW_RUN_STATUS.PASSED, FLOW_RUN_STATUS.FAILED, FLOW_RUN_STATUS.ERROR, FLOW_RUN_STATUS.CANCELLED].includes(run.status)) {
      throw new HttpError(409, 'RUN_FINISHED', 'La corrida ya terminó');
    }
    const updated = await prisma.nativeFlowRun.update({
      where: { id: req.params.runId },
      data: { cancelRequestedAt: new Date() },
      select: { id: true, status: true, cancelRequestedAt: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── Flows ───────────────────────────────────────────────────────────────────

const stepSchema = z
  .object({
    action: z.enum(Object.keys(NATIVE_ACTION_META)),
    strategy: z.string().trim().max(60).optional().nullable(),
    selector: z.string().trim().max(2_000).optional().nullable(),
    value: z.string().max(5_000).optional().nullable(),
    description: z.string().trim().max(500).optional().nullable(),
  })
  .strict()
  .superRefine((step, ctx) => {
    const meta = NATIVE_ACTION_META[step.action];
    if (!meta) return;
    if (meta.needsSelector && !step.selector?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `La acción "${step.action}" requiere un selector` });
    }
    if (meta.needsValue && !(step.value ?? '').toString().trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `La acción "${step.action}" requiere un valor` });
    }
  });

const flowSchema = z.object({
  providerId: z.string().trim().min(1, 'providerId requerido'),
  name: z.string().trim().min(1, 'name requerido').max(200),
  description: z.string().trim().max(2_000).optional().nullable(),
  platform: z.enum(Object.keys(NATIVE_PLATFORMS)).optional(),
  deviceName: z.string().trim().min(1, 'deviceName requerido').max(200),
  platformVersion: z.string().trim().max(60).optional().nullable(),
  app: z.string().trim().max(1_000).optional().nullable(),
  automationName: z.string().trim().max(60).optional().nullable(),
  extraCaps: z.record(z.any()).optional().nullable(),
  continueOnError: z.boolean().optional(),
  steps: z.array(stepSchema).min(1, 'al menos 1 paso').max(MAX_NATIVE_STEPS),
});

async function loadOwnedFlow(id, userId, extra = {}) {
  const flow = await prisma.nativeFlow.findUnique({ where: { id }, ...extra });
  if (!flow || flow.userId !== userId) throw new HttpError(404, 'FLOW_NOT_FOUND', 'Flujo native no encontrado');
  return flow;
}

nativeRouter.post('/flows', async (req, res, next) => {
  try {
    const parse = flowSchema.safeParse(req.body ?? {});
    if (!parse.success) throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    const d = parse.data;
    await loadOwnedProvider(d.providerId, req.user.id); // el provider debe ser del user
    const flow = await prisma.nativeFlow.create({
      data: {
        userId: req.user.id,
        providerId: d.providerId,
        name: d.name,
        description: d.description ?? null,
        platform: d.platform ?? DEFAULT_NATIVE_PLATFORM,
        deviceName: d.deviceName,
        platformVersion: d.platformVersion ?? null,
        app: d.app ?? null,
        automationName: d.automationName ?? null,
        extraCaps: d.extraCaps ?? undefined,
        continueOnError: d.continueOnError ?? false,
        steps: d.steps,
      },
    });
    res.status(201).json({ flow });
  } catch (err) {
    next(err);
  }
});

nativeRouter.get('/flows', async (req, res, next) => {
  try {
    const flows = await prisma.nativeFlow.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        provider: { select: { id: true, label: true, type: true } },
        runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, summary: true, completedAt: true } },
      },
    });
    const slim = flows.map((f) => ({
      ...f,
      stepCount: Array.isArray(f.steps) ? f.steps.length : 0,
      steps: undefined,
      lastRun: f.runs[0] ?? null,
      runs: undefined,
    }));
    res.json({ flows: slim });
  } catch (err) {
    next(err);
  }
});

nativeRouter.get('/flows/:id', async (req, res, next) => {
  try {
    const flow = await loadOwnedFlow(req.params.id, req.user.id, {
      include: {
        provider: { select: { id: true, label: true, type: true } },
        runs: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, summary: true, createdAt: true, completedAt: true, errorMessage: true } },
      },
    });
    const { runs, ...rest } = flow;
    res.json({ flow: rest, runs });
  } catch (err) {
    next(err);
  }
});

nativeRouter.put('/flows/:id', async (req, res, next) => {
  try {
    await loadOwnedFlow(req.params.id, req.user.id);
    const parse = flowSchema.partial().safeParse(req.body ?? {});
    if (!parse.success) throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    const d = parse.data;
    if (d.providerId) await loadOwnedProvider(d.providerId, req.user.id);
    const data = {};
    for (const k of ['providerId', 'name', 'description', 'platform', 'deviceName', 'platformVersion', 'app', 'automationName', 'continueOnError', 'steps']) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    if (d.extraCaps !== undefined) data.extraCaps = d.extraCaps ?? null;
    const flow = await prisma.nativeFlow.update({ where: { id: req.params.id }, data });
    res.json({ flow });
  } catch (err) {
    next(err);
  }
});

nativeRouter.delete('/flows/:id', async (req, res, next) => {
  try {
    await loadOwnedFlow(req.params.id, req.user.id);
    await prisma.nativeFlow.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

nativeRouter.post('/flows/:id/run', async (req, res, next) => {
  try {
    const flow = await loadOwnedFlow(req.params.id, req.user.id);
    const run = await prisma.nativeFlowRun.create({ data: { nativeFlowId: flow.id, status: FLOW_RUN_STATUS.PENDING } });
    await enqueueNativeFlowRun(run.id);
    res.status(201).json({ run });
  } catch (err) {
    next(err);
  }
});

nativeRouter.get('/flows/:id/runs', async (req, res, next) => {
  try {
    await loadOwnedFlow(req.params.id, req.user.id);
    const runs = await prisma.nativeFlowRun.findMany({
      where: { nativeFlowId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, status: true, summary: true, createdAt: true, completedAt: true, errorMessage: true },
    });
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});
