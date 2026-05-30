// FASE 10: repositorio de casos de prueba manuales. CRUD de SUTs (software bajo
// prueba) y casos de prueba, import desde un scan, y un chatbot de IA que puede
// ver y proponer cambios sobre los casos. Montado en /api/repository. Requiere
// auth pero el repositorio es compartido por todo el equipo (sin filtro de user).

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middlewares/error.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { prisma } from '../../db/client.js';
import { resolveProvider } from '../../generators/providers/index.js';
import { getManualCasesForScan } from '../../generators/manualcases.generator.js';

export const repositoryRouter = Router();

repositoryRouter.use(requireAuth);

// ─── Validación ─────────────────────────────────────────────────────────────

const stepSchema = z.object({
  action: z.string().trim().max(2_000),
  expected: z.string().trim().max(2_000),
});

/** Campos editables de un caso de prueba (para create — title obligatorio). */
const testCaseSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio').max(300),
  description: z.string().max(4_000).nullable().optional(),
  module: z.string().max(120).nullable().optional(),
  testType: z.string().max(40).optional(),
  category: z.string().max(40).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status: z.enum(['draft', 'active', 'deprecated']).optional(),
  preconditions: z.array(z.string().max(1_000)).max(50).optional(),
  steps: z.array(stepSchema).max(100).optional(),
  postconditions: z.array(z.string().max(1_000)).max(50).optional(),
  expectedResult: z.string().max(4_000).nullable().optional(),
  testData: z.string().max(4_000).nullable().optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  automationStatus: z.enum(['not-automated', 'candidate', 'automated']).optional(),
  requirementRef: z.string().max(500).nullable().optional(),
  notes: z.string().max(4_000).nullable().optional(),
});
const testCasePatchSchema = testCaseSchema.partial();

const sutSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(160),
  description: z.string().max(2_000).nullable().optional(),
  baseUrl: z.string().max(500).nullable().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Próximo código TC-NNN para un SUT, considerando códigos ya tomados en lote. */
function nextCode(existingCodes, takenCount) {
  const nums = existingCodes
    .map((c) => parseInt(String(c).replace(/\D/g, ''), 10))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `TC-${String(max + 1 + takenCount).padStart(3, '0')}`;
}

/** Arma el objeto Prisma `data` para crear un caso a partir de campos validados. */
function buildCreateData(fields, { sutId, code, userId }) {
  return {
    sutId,
    code,
    title: fields.title,
    description: fields.description ?? null,
    module: fields.module ?? null,
    testType: fields.testType || 'functional',
    category: fields.category || 'functional',
    priority: fields.priority || 'medium',
    status: fields.status || 'active',
    preconditions: fields.preconditions ?? [],
    steps: fields.steps ?? [],
    postconditions: fields.postconditions ?? [],
    expectedResult: fields.expectedResult ?? null,
    testData: fields.testData ?? null,
    tags: fields.tags ?? [],
    estimatedMinutes: fields.estimatedMinutes ?? null,
    automationStatus: fields.automationStatus || 'not-automated',
    requirementRef: fields.requirementRef ?? null,
    notes: fields.notes ?? null,
    createdById: userId ?? null,
    updatedById: userId ?? null,
  };
}

/** Sólo las claves presentes en `fields` (para PATCH parcial). */
function buildUpdateData(fields, userId) {
  const data = { updatedById: userId ?? null };
  for (const key of Object.keys(fields)) {
    if (fields[key] !== undefined) data[key] = fields[key];
  }
  return data;
}

async function getSutOr404(sutId) {
  const sut = await prisma.sut.findUnique({ where: { id: sutId } });
  if (!sut) throw new HttpError(404, 'SUT_NOT_FOUND', 'Software bajo prueba no encontrado');
  return sut;
}

// ─── SUTs ───────────────────────────────────────────────────────────────────

/** GET /api/repository/suts — lista de SUTs con cantidad de casos. */
repositoryRouter.get('/suts', async (_req, res, next) => {
  try {
    const suts = await prisma.sut.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { testCases: true } } },
    });
    res.json({
      suts: suts.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        baseUrl: s.baseUrl,
        caseCount: s._count.testCases,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/repository/suts — crea un SUT. */
repositoryRouter.post('/suts', async (req, res, next) => {
  try {
    const parse = sutSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const sut = await prisma.sut.create({
      data: {
        name: parse.data.name,
        description: parse.data.description ?? null,
        baseUrl: parse.data.baseUrl ?? null,
        createdById: req.user.id,
      },
    });
    res.status(201).json({ sut });
  } catch (err) {
    next(err);
  }
});

/** GET /api/repository/suts/:sutId — SUT + todos sus casos. */
repositoryRouter.get('/suts/:sutId', async (req, res, next) => {
  try {
    const sut = await getSutOr404(req.params.sutId);
    const testCases = await prisma.testCase.findMany({
      where: { sutId: sut.id },
      orderBy: { code: 'asc' },
    });
    res.json({ sut, testCases });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/repository/suts/:sutId — actualiza un SUT. */
repositoryRouter.patch('/suts/:sutId', async (req, res, next) => {
  try {
    await getSutOr404(req.params.sutId);
    const parse = sutSchema.partial().safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const sut = await prisma.sut.update({ where: { id: req.params.sutId }, data: parse.data });
    res.json({ sut });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/repository/suts/:sutId — borra el SUT y todos sus casos. */
repositoryRouter.delete('/suts/:sutId', async (req, res, next) => {
  try {
    await getSutOr404(req.params.sutId);
    await prisma.sut.delete({ where: { id: req.params.sutId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ─── Casos de prueba ────────────────────────────────────────────────────────

/** POST /api/repository/suts/:sutId/cases — crea un caso. */
repositoryRouter.post('/suts/:sutId/cases', async (req, res, next) => {
  try {
    await getSutOr404(req.params.sutId);
    const parse = testCaseSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const existing = await prisma.testCase.findMany({
      where: { sutId: req.params.sutId },
      select: { code: true },
    });
    const code = nextCode(existing.map((c) => c.code), 0);
    const testCase = await prisma.testCase.create({
      data: buildCreateData(parse.data, { sutId: req.params.sutId, code, userId: req.user.id }),
    });
    res.status(201).json({ testCase });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/repository/cases/:caseId — actualiza un caso. */
repositoryRouter.patch('/cases/:caseId', async (req, res, next) => {
  try {
    const existing = await prisma.testCase.findUnique({ where: { id: req.params.caseId } });
    if (!existing) throw new HttpError(404, 'CASE_NOT_FOUND', 'Caso de prueba no encontrado');
    const parse = testCasePatchSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }
    const testCase = await prisma.testCase.update({
      where: { id: req.params.caseId },
      data: buildUpdateData(parse.data, req.user.id),
    });
    res.json({ testCase });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/repository/cases/:caseId — borra un caso. */
repositoryRouter.delete('/cases/:caseId', async (req, res, next) => {
  try {
    const deleted = await prisma.testCase.deleteMany({ where: { id: req.params.caseId } });
    if (deleted.count === 0) {
      throw new HttpError(404, 'CASE_NOT_FOUND', 'Caso de prueba no encontrado');
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ─── Aplicar acciones en lote (usado por el chatbot) ────────────────────────

const actionSchema = z.object({
  op: z.enum(['create', 'update', 'delete']),
  caseId: z.string().optional(),
  fields: testCasePatchSchema.optional(),
});
const applySchema = z.object({ actions: z.array(actionSchema).min(1).max(100) });

/**
 * Los modelos en JSON strict mode (OpenAI sanitiza el schema a "todo required +
 * nullable") devuelven `null` en los campos opcionales que no usan — p.ej.
 * `caseId: null` en un create, o `testType: null`. Para los schemas de acá un
 * `null` significa "ausente", no un valor nulo, así que lo descartamos antes de
 * validar (si no, Zod tira "Expected string, received null"). Recursivo.
 */
function dropNulls(value) {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = dropNulls(v);
    }
    return out;
  }
  return value;
}

/**
 * POST /api/repository/suts/:sutId/cases/apply
 * Aplica un lote de acciones create/update/delete en una transacción.
 * Lo usa el frontend tras confirmar las acciones propuestas por el chatbot.
 */
repositoryRouter.post('/suts/:sutId/cases/apply', async (req, res, next) => {
  try {
    const sut = await getSutOr404(req.params.sutId);
    const parse = applySchema.safeParse(dropNulls(req.body ?? {}));
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }

    const existing = await prisma.testCase.findMany({
      where: { sutId: sut.id },
      select: { id: true, code: true },
    });
    const codes = existing.map((c) => c.code);
    const validIds = new Set(existing.map((c) => c.id));

    await prisma.$transaction(async (tx) => {
      let created = 0;
      for (const action of parse.data.actions) {
        if (action.op === 'create') {
          const fields = action.fields ?? {};
          if (!fields.title || !fields.title.trim()) {
            throw new HttpError(400, 'INVALID_INPUT', 'Un caso nuevo necesita un título.');
          }
          const code = nextCode(codes, created);
          created += 1;
          await tx.testCase.create({
            data: buildCreateData(fields, { sutId: sut.id, code, userId: req.user.id }),
          });
        } else if (action.op === 'update') {
          if (!action.caseId || !validIds.has(action.caseId)) {
            throw new HttpError(400, 'INVALID_INPUT', `Caso a editar inexistente: ${action.caseId}`);
          }
          await tx.testCase.update({
            where: { id: action.caseId },
            data: buildUpdateData(action.fields ?? {}, req.user.id),
          });
        } else if (action.op === 'delete') {
          if (!action.caseId || !validIds.has(action.caseId)) {
            throw new HttpError(400, 'INVALID_INPUT', `Caso a borrar inexistente: ${action.caseId}`);
          }
          await tx.testCase.delete({ where: { id: action.caseId } });
        }
      }
    });

    const testCases = await prisma.testCase.findMany({
      where: { sutId: sut.id },
      orderBy: { code: 'asc' },
    });
    res.json({ testCases });
  } catch (err) {
    next(err);
  }
});

// ─── Import desde un scan ───────────────────────────────────────────────────

/**
 * POST /api/repository/suts/:sutId/import-from-scan
 * Importa al SUT los casos manuales de un scan: los generados por IA y los
 * casos custom del runner. Body: { scanId }.
 */
repositoryRouter.post('/suts/:sutId/import-from-scan', async (req, res, next) => {
  try {
    const sut = await getSutOr404(req.params.sutId);
    const scanId = String(req.body?.scanId ?? '').trim();
    if (!scanId) throw new HttpError(400, 'INVALID_INPUT', 'Falta scanId');

    const scan = await prisma.scan.findUnique({ where: { id: scanId }, select: { id: true } });
    if (!scan) throw new HttpError(404, 'SCAN_NOT_FOUND', 'Scan no encontrado');

    const sources = [];
    const aiData = await getManualCasesForScan(scanId);
    for (const tc of aiData?.manualCases ?? []) {
      sources.push({
        title: tc.title,
        description: null,
        category: tc.category || 'functional',
        priority: tc.priority || 'medium',
        preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : [],
        steps: Array.isArray(tc.steps) ? tc.steps : [],
        postconditions: Array.isArray(tc.postconditions) ? tc.postconditions : [],
        testData: tc.testData ?? null,
        notes: tc.notes ?? null,
        tags: ['importado', 'ia'],
      });
    }
    const customRuns = await prisma.manualCaseRun.findMany({
      where: { scanId, source: 'custom' },
    });
    for (const run of customRuns) {
      const p = run.payload ?? {};
      if (!p.title) continue;
      sources.push({
        title: p.title,
        description: p.description ?? null,
        category: p.category || 'functional',
        priority: p.priority || 'medium',
        preconditions: [],
        steps: [],
        postconditions: [],
        tags: ['importado', 'custom'],
      });
    }

    if (sources.length === 0) {
      throw new HttpError(
        409,
        'NOTHING_TO_IMPORT',
        'Ese scan no tiene casos manuales (generá casos con IA o agregá casos custom primero).',
      );
    }

    const existing = await prisma.testCase.findMany({
      where: { sutId: sut.id },
      select: { code: true },
    });
    const codes = existing.map((c) => c.code);

    const created = await prisma.$transaction(
      sources.map((fields, i) =>
        prisma.testCase.create({
          data: buildCreateData(fields, {
            sutId: sut.id,
            code: nextCode(codes, i),
            userId: req.user.id,
          }),
        }),
      ),
    );
    res.status(201).json({ imported: created.length, testCases: created });
  } catch (err) {
    next(err);
  }
});

// ─── Chatbot de IA ──────────────────────────────────────────────────────────

const CHAT_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['create', 'update', 'delete'] },
          caseId: { type: 'string' },
          fields: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              module: { type: 'string' },
              testType: { type: 'string' },
              category: { type: 'string' },
              priority: { type: 'string' },
              status: { type: 'string' },
              preconditions: { type: 'array', items: { type: 'string' } },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { action: { type: 'string' }, expected: { type: 'string' } },
                  required: ['action', 'expected'],
                  additionalProperties: false,
                },
              },
              postconditions: { type: 'array', items: { type: 'string' } },
              expectedResult: { type: 'string' },
              testData: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
        },
        required: ['op'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'actions'],
  additionalProperties: false,
});

const CHAT_SYSTEM_PROMPT = `Eres un asistente experto en QA manual integrado al repositorio de casos de
prueba de QA Forge. Ayudás a un equipo de QA a consultar, analizar y mantener
los casos de prueba de un software bajo prueba (SUT).

Podés hacer dos cosas:
1. RESPONDER preguntas sobre los casos (analizarlos, resumirlos, detectar huecos
   de cobertura, sugerir mejoras). En ese caso devolvé "actions" vacío.
2. PROPONER cambios cuando el usuario pide crear, editar o borrar casos. Cada
   cambio va en "actions". El usuario los revisa y confirma — vos sólo proponés.

Reglas de las acciones:
- op="create": completá "fields" con un caso nuevo. "title" es obligatorio.
  Diseñá casos profesionales: pasos accionables y atómicos, cada paso con su
  "expected", precondiciones explícitas, prioridad honesta.
- op="update": "caseId" DEBE ser un id exacto de la lista de casos actuales.
  En "fields" poné SÓLO los campos que cambian.
- op="delete": "caseId" exacto de la lista. Sin "fields".
- NUNCA inventes un caseId. Si no estás seguro de a qué caso se refiere el
  usuario, pedí aclaración en "reply" y dejá "actions" vacío.

Valores válidos:
- category: functional | security | performance | accessibility | seo | ux
- testType: functional | regression | smoke | integration | acceptance | exploratory | negative | usability
- priority: critical | high | medium | low
- status: draft | active | deprecated

En "reply" explicá en español, claro y conciso, qué encontraste o qué cambios
proponés y por qué. Devolvé ÚNICAMENTE el JSON del schema.`;

function buildChatUserMessage({ sut, testCases, messages }) {
  const caseSummary = testCases.map((tc) => ({
    caseId: tc.id,
    code: tc.code,
    title: tc.title,
    description: tc.description,
    module: tc.module,
    testType: tc.testType,
    category: tc.category,
    priority: tc.priority,
    status: tc.status,
    preconditions: tc.preconditions,
    steps: tc.steps,
    postconditions: tc.postconditions,
    expectedResult: tc.expectedResult,
    testData: tc.testData,
    tags: tc.tags,
  }));
  const transcript = messages
    .map((m) => `${m.role === 'assistant' ? 'Asistente' : 'Usuario'}: ${m.content}`)
    .join('\n');
  return [
    `SUT: ${sut.name}${sut.description ? ` — ${sut.description}` : ''}`,
    sut.baseUrl ? `URL: ${sut.baseUrl}` : '',
    '',
    `Casos de prueba actuales del repositorio (${testCases.length}):`,
    '```json',
    JSON.stringify(caseSummary, null, 2),
    '```',
    '',
    'Conversación:',
    transcript,
    '',
    'Respondé al último mensaje del usuario según el schema JSON.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(8_000),
      }),
    )
    .min(1)
    .max(40),
  provider: z.string().trim().max(40).optional().nullable(),
  model: z.string().trim().max(200).optional().nullable(),
});

/**
 * POST /api/repository/suts/:sutId/chat
 * Chatbot que ve los casos del SUT y propone cambios. No aplica nada — devuelve
 * { reply, actions } para que el frontend muestre y el usuario confirme.
 */
repositoryRouter.post('/suts/:sutId/chat', async (req, res, next) => {
  try {
    const sut = await getSutOr404(req.params.sutId);
    const parse = chatSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      throw new HttpError(400, 'INVALID_INPUT', parse.error.errors[0]?.message ?? 'Body inválido');
    }

    const testCases = await prisma.testCase.findMany({
      where: { sutId: sut.id },
      orderBy: { code: 'asc' },
    });

    const { provider, apiKey } = await resolveProvider({
      requestedId: parse.data.provider ?? null,
      userId: req.user.id,
    });

    const result = await provider.generateStructured({
      system: CHAT_SYSTEM_PROMPT,
      user: buildChatUserMessage({ sut, testCases, messages: parse.data.messages }),
      schema: CHAT_OUTPUT_SCHEMA,
      model: parse.data.model ?? null,
      apiKey,
    });

    const parsed = result.parsed ?? {};
    res.json({
      reply: typeof parsed.reply === 'string' ? parsed.reply : '',
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      provider: result.providerId,
      model: result.model,
      usage: result.usage ?? null,
    });
  } catch (err) {
    next(err);
  }
});
