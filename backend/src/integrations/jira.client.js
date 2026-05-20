// FASE 8.10: cliente REST de Jira Cloud. Auth Basic con email + API token.
// Cubre lo mínimo para la integración: validar credenciales, listar proyectos
// y crear issues. Las descripciones van en Atlassian Document Format (ADF),
// requerido por la REST API v3.

const REQUEST_TIMEOUT_MS = 15_000;

/** Error de la integración con Jira. `status` mapea a un HTTP de respuesta. */
export class JiraError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
    this.code = code;
  }
}

/** Normaliza la baseUrl: valida que sea http(s) y saca el trailing slash. */
export function normalizeBaseUrl(raw) {
  let value = String(raw ?? '').trim();
  if (!value) throw new JiraError(400, 'INVALID_BASE_URL', 'baseUrl de Jira requerida');
  value = value.replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new JiraError(400, 'INVALID_BASE_URL', 'baseUrl de Jira inválida');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new JiraError(400, 'INVALID_BASE_URL', 'baseUrl debe ser http(s)');
  }
  return value;
}

/** Hace un request autenticado a la REST API de Jira. */
async function jiraRequest({ baseUrl, email, token }, method, path, body) {
  const base = normalizeBaseUrl(baseUrl);
  if (!email || !token) {
    throw new JiraError(400, 'MISSING_CREDENTIALS', 'email y API token de Jira requeridos');
  }
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new JiraError(504, 'JIRA_TIMEOUT', 'Jira no respondió a tiempo');
    }
    throw new JiraError(502, 'JIRA_UNREACHABLE', `No se pudo contactar a Jira: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) throw mapJiraError(res.status, payload);
  return payload;
}

/** Traduce un error de Jira a un JiraError con mensaje legible. */
function mapJiraError(status, payload) {
  const detail = extractJiraMessage(payload);
  if (status === 401) {
    return new JiraError(401, 'JIRA_AUTH', 'Credenciales de Jira inválidas (email o API token).');
  }
  if (status === 403) {
    return new JiraError(
      403,
      'JIRA_FORBIDDEN',
      `Jira rechazó el acceso${detail ? `: ${detail}` : ''}. Verificá permisos de la cuenta.`,
    );
  }
  if (status === 404) {
    return new JiraError(
      404,
      'JIRA_NOT_FOUND',
      `Recurso no encontrado en Jira${detail ? `: ${detail}` : ''}. Revisá la baseUrl o el project key.`,
    );
  }
  if (status === 400) {
    return new JiraError(400, 'JIRA_BAD_REQUEST', detail || 'Jira rechazó el request (400).');
  }
  return new JiraError(502, 'JIRA_ERROR', `Jira respondió ${status}${detail ? `: ${detail}` : ''}`);
}

/** Junta errorMessages + errors{} de una respuesta de error de Jira. */
function extractJiraMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const parts = [];
  if (Array.isArray(payload.errorMessages)) parts.push(...payload.errorMessages);
  if (payload.errors && typeof payload.errors === 'object') {
    for (const [field, msg] of Object.entries(payload.errors)) parts.push(`${field}: ${msg}`);
  }
  if (typeof payload.message === 'string') parts.push(payload.message);
  return parts.join(' · ').slice(0, 400);
}

/**
 * Valida credenciales contra GET /myself. Devuelve datos básicos del usuario.
 */
export async function testConnection(creds) {
  const me = await jiraRequest(creds, 'GET', '/rest/api/3/myself');
  return {
    accountId: me?.accountId ?? null,
    displayName: me?.displayName ?? null,
    emailAddress: me?.emailAddress ?? null,
  };
}

/** Lista proyectos accesibles (para el dropdown del form). */
export async function listProjects(creds) {
  const data = await jiraRequest(
    creds,
    'GET',
    '/rest/api/3/project/search?maxResults=50&orderBy=key',
  );
  const values = Array.isArray(data?.values) ? data.values : [];
  return values.map((p) => ({ id: p.id, key: p.key, name: p.name }));
}

/**
 * Crea un issue en Jira. `descriptionAdf` debe ser un documento ADF (ver
 * helpers adf* abajo). Devuelve { key, id, url }.
 */
export async function createIssue(creds, { projectKey, issueType, summary, descriptionAdf, labels }) {
  if (!projectKey) throw new JiraError(400, 'MISSING_PROJECT', 'projectKey requerido');
  const fields = {
    project: { key: projectKey },
    issuetype: { name: issueType || 'Bug' },
    summary: String(summary || '').slice(0, 250),
  };
  if (descriptionAdf) fields.description = descriptionAdf;
  if (Array.isArray(labels) && labels.length > 0) {
    // Jira no acepta espacios en labels.
    fields.labels = labels.map((l) => String(l).replace(/\s+/g, '-')).slice(0, 10);
  }
  const created = await jiraRequest(creds, 'POST', '/rest/api/3/issue', { fields });
  const key = created?.key;
  if (!key) throw new JiraError(502, 'JIRA_ERROR', 'Jira no devolvió la key del issue creado');
  return {
    key,
    id: created.id ?? null,
    url: `${normalizeBaseUrl(creds.baseUrl)}/browse/${key}`,
  };
}

// ─── Helpers ADF (Atlassian Document Format) ───────────────────────────────
// La REST API v3 exige que `description` sea un documento ADF, no texto plano.

/** Nodo de texto. Pasá `{ strong: true }` o `{ href }` para marcas. */
export function adfText(text, opts = {}) {
  const node = { type: 'text', text: String(text ?? '') };
  const marks = [];
  if (opts.strong) marks.push({ type: 'strong' });
  if (opts.href) marks.push({ type: 'link', attrs: { href: opts.href } });
  if (opts.code) marks.push({ type: 'code' });
  if (marks.length) node.marks = marks;
  return node;
}

/** Párrafo a partir de uno o más nodos de texto (o un string). */
export function adfParagraph(content) {
  const nodes = Array.isArray(content) ? content : [adfText(content)];
  return { type: 'paragraph', content: nodes };
}

/** Encabezado (level 1-6). */
export function adfHeading(text, level = 3) {
  return { type: 'heading', attrs: { level }, content: [adfText(text)] };
}

/** Lista con viñetas. `items` es un array de strings o de arrays de nodos. */
export function adfBulletList(items) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [adfParagraph(item)],
    })),
  };
}

/** Documento ADF raíz a partir de bloques. */
export function adfDoc(blocks) {
  return { type: 'doc', version: 1, content: blocks.filter(Boolean) };
}
