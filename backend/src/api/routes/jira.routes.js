// FASE 8.10: integración con Jira. Config por usuario (cifrada) + creación de
// bugs desde un Result. Montado en /api/integrations/jira. Requiere auth.

import { Router } from 'express';
import { z } from 'zod';

import { decrypt, encrypt, maskKey } from '../../auth/crypto.js';
import { parseDetails, prisma } from '../../db/client.js';
import { HttpError } from '../middlewares/error.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { createIssue, listProjects, normalizeBaseUrl, testConnection } from '../../integrations/jira.client.js';
import { buildBugContent, buildManualCaseBugContent } from '../../integrations/jira.issue.js';

export const jiraRouter = Router();

jiraRouter.use(requireAuth);

const configSchema = z.object({
  baseUrl: z.string().trim().min(1).max(300),
  email: z.string().trim().email().max(200),
  token: z.string().trim().min(8, 'API token demasiado corto').max(500).optional(),
  defaultProjectKey: z.string().trim().max(40).optional().nullable(),
  defaultIssueType: z.string().trim().max(60).optional(),
});

/** Quita el token cifrado y expone solo el hint + flag de configurado. */
function sanitizeConfig(config) {
  if (!config) return { configured: false, config: null };
  return {
    configured: true,
    config: {
      baseUrl: config.baseUrl,
      email: config.email,
      hint: config.hint,
      defaultProjectKey: config.defaultProjectKey,
      defaultIssueType: config.defaultIssueType,
      updatedAt: config.updatedAt,
    },
  };
}

/** Carga la config del user y devuelve las credenciales descifradas. */
async function loadCredentials(userId) {
  const config = await prisma.jiraConfig.findUnique({ where: { userId } });
  if (!config) {
    throw new HttpError(409, 'JIRA_NOT_CONFIGURED', 'Configurá Jira primero en Ajustes.');
  }
  return {
    config,
    creds: {
      baseUrl: config.baseUrl,
      email: config.email,
      token: decrypt(config.encryptedToken),
    },
  };
}

/** GET /api/integrations/jira → config del user (sin el token). */
jiraRouter.get('/', async (req, res, next) => {
  try {
    const config = await prisma.jiraConfig.findUnique({ where: { userId: req.user.id } });
    res.json(sanitizeConfig(config));
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/integrations/jira → crea o actualiza la config.
 * El token es opcional al actualizar: si se omite, se conserva el actual.
 */
jiraRouter.put('/', async (req, res, next) => {
  try {
    const parse = configSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const { baseUrl, email, token, defaultProjectKey, defaultIssueType } = parse.data;
    const normalizedUrl = normalizeBaseUrl(baseUrl); // valida formato

    const existing = await prisma.jiraConfig.findUnique({ where: { userId: req.user.id } });
    if (!existing && !token) {
      throw new HttpError(400, 'TOKEN_REQUIRED', 'El API token es obligatorio la primera vez.');
    }

    const data = {
      baseUrl: normalizedUrl,
      email,
      defaultProjectKey: defaultProjectKey || null,
      defaultIssueType: defaultIssueType || 'Bug',
    };
    if (token) {
      data.encryptedToken = encrypt(token);
      data.hint = maskKey(token);
    }

    // En `create` el token siempre está presente (lo exigimos arriba si no
    // había config previa), así que `data` ya trae encryptedToken + hint.
    const saved = await prisma.jiraConfig.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, ...data },
      update: data,
    });
    res.json(sanitizeConfig(saved));
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/integrations/jira → borra la config. */
jiraRouter.delete('/', async (req, res, next) => {
  try {
    await prisma.jiraConfig.deleteMany({ where: { userId: req.user.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/integrations/jira/test → valida credenciales contra GET /myself.
 * Acepta credenciales en el body (para probar antes de guardar); si no, usa
 * las guardadas. Si el body trae baseUrl+email sin token, reusa el guardado.
 */
jiraRouter.post('/test', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    let creds;
    if (body.baseUrl && body.email && body.token) {
      creds = { baseUrl: body.baseUrl, email: body.email, token: body.token };
    } else {
      const stored = await loadCredentials(req.user.id);
      creds = stored.creds;
      // Permitir override parcial desde el body (ej. cambió baseUrl pero no token).
      if (body.baseUrl) creds.baseUrl = body.baseUrl;
      if (body.email) creds.email = body.email;
    }
    const user = await testConnection(creds);
    res.json({ ok: true, user });
  } catch (err) {
    next(err);
  }
});

/** GET /api/integrations/jira/projects → proyectos accesibles. */
jiraRouter.get('/projects', async (req, res, next) => {
  try {
    const { creds } = await loadCredentials(req.user.id);
    const projects = await listProjects(creds);
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

/** GET /api/integrations/jira/issues?scanId=... → bugs ya creados para un scan. */
jiraRouter.get('/issues', async (req, res, next) => {
  try {
    const scanId = String(req.query.scanId ?? '').trim();
    if (!scanId) throw new HttpError(400, 'INVALID_INPUT', 'scanId requerido');
    const issues = await prisma.jiraIssueLink.findMany({
      where: { scanId, userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, scanId: true, resultId: true, issueKey: true, issueUrl: true, summary: true, createdAt: true },
    });
    res.json({ issues });
  } catch (err) {
    next(err);
  }
});

// Definición de un caso del runner manual (FASE 9) — alternativa a resultId.
const manualCaseSchema = z.object({
  caseKey: z.string().trim().min(1).max(200),
  source: z.string().trim().max(20),
  title: z.string().trim().min(1).max(400),
  category: z.string().trim().max(40),
  priority: z.string().trim().max(20).optional(),
  description: z.string().max(8_000).optional().nullable(),
  notes: z.string().max(8_000).optional().nullable(),
  steps: z
    .array(z.object({ action: z.string().max(2_000), expected: z.string().max(2_000) }))
    .max(60)
    .optional(),
});

const issueSchema = z
  .object({
    scanId: z.string().min(1),
    resultId: z.string().min(1).optional(),
    manualCase: manualCaseSchema.optional(),
    projectKey: z.string().trim().max(40).optional(),
    issueType: z.string().trim().max(60).optional(),
    summary: z.string().trim().max(240).optional(),
  })
  .refine((d) => Boolean(d.resultId) || Boolean(d.manualCase), {
    message: 'Indicá un resultId (test automático) o un manualCase (caso del runner).',
  });

/**
 * POST /api/integrations/jira/issue → crea un bug en Jira.
 * Body: { scanId, projectKey?, issueType?, summary? } + uno de:
 *   - { resultId }   → bug desde un Result automático del scan
 *   - { manualCase } → bug desde un caso del runner manual (FASE 9)
 */
jiraRouter.post('/issue', async (req, res, next) => {
  try {
    const parse = issueSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const { scanId, resultId, manualCase, projectKey, issueType, summary } = parse.data;

    const { config, creds } = await loadCredentials(req.user.id);

    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      select: { id: true, url: true, userId: true },
    });
    if (!scan) throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');
    if (scan.userId && scan.userId !== req.user.id) {
      throw new HttpError(403, 'FORBIDDEN', 'El scan pertenece a otro usuario');
    }

    // `resultId` enlaza el bug a su origen. Para casos manuales reusamos el
    // campo guardando el caseKey — así el dedup y el listado funcionan igual.
    const linkKey = manualCase ? manualCase.caseKey : resultId;

    const existing = await prisma.jiraIssueLink.findFirst({
      where: { resultId: linkKey, userId: req.user.id },
    });
    if (existing) {
      throw new HttpError(
        409,
        'ISSUE_ALREADY_EXISTS',
        `Ya existe un bug para este caso: ${existing.issueKey}`,
      );
    }

    const targetProject = projectKey || config.defaultProjectKey;
    if (!targetProject) {
      throw new HttpError(400, 'MISSING_PROJECT', 'Indicá un project key (o seteá uno default).');
    }

    const reportUrl = buildReportUrl(scanId);

    let content;
    if (manualCase) {
      content = buildManualCaseBugContent({ scan, manualCase, reportUrl });
    } else {
      const result = await prisma.result.findUnique({ where: { id: resultId } });
      if (!result || result.scanId !== scanId) {
        throw new HttpError(404, 'RESULT_NOT_FOUND', 'Result no encontrado en este scan');
      }
      content = buildBugContent({
        scan,
        result: { ...result, details: parseDetails(result.details) },
        reportUrl,
      });
    }

    const created = await createIssue(creds, {
      projectKey: targetProject,
      issueType: issueType || config.defaultIssueType || 'Bug',
      summary: summary || content.summary,
      descriptionAdf: content.descriptionAdf,
      labels: content.labels,
    });

    const link = await prisma.jiraIssueLink.create({
      data: {
        userId: req.user.id,
        scanId,
        resultId: linkKey,
        issueKey: created.key,
        issueUrl: created.url,
        summary: summary || content.summary,
      },
      select: { id: true, scanId: true, resultId: true, issueKey: true, issueUrl: true, summary: true, createdAt: true },
    });

    res.status(201).json({ issue: link });
  } catch (err) {
    next(err);
  }
});

/** Arma el link al reporte en el frontend (mismo criterio que el notifier). */
function buildReportUrl(scanId) {
  const base =
    process.env.PUBLIC_FRONTEND_URL ||
    process.env.FRONTEND_URL?.split(',')[0]?.trim() ||
    '';
  return base ? `${base.replace(/\/+$/, '')}/scan/${scanId}/report` : null;
}
