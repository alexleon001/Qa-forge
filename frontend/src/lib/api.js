// Cliente HTTP para el backend de QA Forge.

import axios from 'axios';

import { getAuthToken, useAuthStore } from '../store/auth.store.js';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = axios.create({
  baseURL,
  timeout: 30_000,
});

// Cliente con timeout más largo para llamadas de generación con LLM (OpenRouter
// free, Anthropic con thinking, Gemini con prompts largos pueden tardar 1-2min).
const aiApi = axios.create({
  baseURL,
  timeout: 180_000,
});

// Interceptor: inyectar JWT en cada request si hay sesión activa.
function authHeaderInterceptor(config) {
  const token = getAuthToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}
api.interceptors.request.use(authHeaderInterceptor);
aiApi.interceptors.request.use(authHeaderInterceptor);

// Si el server devuelve 401, limpiar la sesión (token expirado o inválido).
function authErrorInterceptor(error) {
  if (error?.response?.status === 401) {
    const code = error?.response?.data?.error;
    // Solo invalidar si es realmente un token issue, no errores de credenciales en login.
    if (code === 'UNAUTHENTICATED') {
      useAuthStore.getState().logout();
    }
  }
  return Promise.reject(error);
}
api.interceptors.response.use((r) => r, authErrorInterceptor);
aiApi.interceptors.response.use((r) => r, authErrorInterceptor);

export async function createScan(
  url,
  { deviceProfile, browserEngine, mode, maxPages, loginConfig } = {},
) {
  const body = {
    url,
    deviceProfile: deviceProfile ?? null,
  };
  if (browserEngine) body.browserEngine = browserEngine;
  if (mode) body.mode = mode;
  if (maxPages) body.maxPages = maxPages;
  if (loginConfig) body.loginConfig = loginConfig;
  const { data } = await api.post('/api/scan', body);
  return data;
}

export async function getScan(scanId) {
  const { data } = await api.get(`/api/scan/${scanId}`);
  return data;
}

export async function getReport(scanId) {
  const { data } = await api.get(`/api/report/${scanId}`);
  return data;
}

/**
 * Lista scans paginados. Devuelve { scans, pagination } donde pagination es
 * { page, pageSize, total, totalPages, hasMore }.
 */
export async function listScans({ page = 1, pageSize = 50 } = {}) {
  const { data } = await api.get('/api/scan', { params: { page, pageSize } });
  return data;
}

/** Actualiza notas (u otros campos editables) de un scan. */
export async function updateScan(scanId, patch) {
  const { data } = await api.patch(`/api/scan/${scanId}`, patch);
  return data;
}

/** Solicita la cancelación del scan en curso. */
export async function cancelScan(scanId) {
  const { data } = await api.post(`/api/scan/${scanId}/cancel`);
  return data;
}

// ─── Auth ──────────────────────────────────────────────────────────────

export async function registerUser({ email, password, name }) {
  const { data } = await api.post('/api/auth/register', { email, password, name });
  return data;
}

export async function loginUser({ email, password }) {
  const { data } = await api.post('/api/auth/login', { email, password });
  return data;
}

export async function getMe() {
  const { data } = await api.get('/api/auth/me');
  return data.user;
}

// ─── API Keys del usuario ──────────────────────────────────────────────

export async function listUserApiKeys() {
  const { data } = await api.get('/api/user/api-keys');
  return data.apiKeys;
}

export async function createUserApiKey({ provider, key, label, isDefault }) {
  const { data } = await api.post('/api/user/api-keys', {
    provider,
    key,
    label: label ?? null,
    isDefault: Boolean(isDefault),
  });
  return data.apiKey;
}

export async function deleteUserApiKey(id) {
  await api.delete(`/api/user/api-keys/${id}`);
}

export async function setUserApiKeyDefault(id) {
  const { data } = await api.patch(`/api/user/api-keys/${id}/default`);
  return data.apiKey;
}

/**
 * Pide al backend que genere (o recupere) los 3 scripts del scan.
 * Opcionales: additionalCases, force, provider, model.
 */
export async function generateScripts(
  scanId,
  { additionalCases, force, provider, model } = {},
) {
  const { data } = await aiApi.post(`/api/scripts/${scanId}`, {
    additionalCases: additionalCases ?? null,
    force: force ?? false,
    provider: provider ?? null,
    model: model ?? null,
  });
  return data;
}

export async function getScripts(scanId) {
  const { data } = await api.get(`/api/scripts/${scanId}`);
  return data;
}

/**
 * Auto-healing de selectores del script Playwright: el backend carga la URL en
 * vivo, verifica cada selector y la IA repara los rotos. Con apply=true persiste.
 * Usa aiApi (180s) porque lanza el browser + LLM.
 */
export async function healScript(scanId, { provider, model, apply, healedContent } = {}) {
  const { data } = await aiApi.post(`/api/scripts/${scanId}/heal`, {
    provider: provider ?? null,
    model: model ?? null,
    apply: apply ?? false,
    healedContent: healedContent ?? null,
  });
  return data;
}

/** Lista los providers disponibles y cuáles están configurados. */
export async function getProviders() {
  const { data } = await api.get('/api/scripts/providers');
  return data;
}

/**
 * Pide al backend que genere (o recupere) los casos de prueba manuales del scan.
 * Opcionales: additionalCases, force, provider, model.
 */
export async function generateManualCases(
  scanId,
  { additionalCases, force, provider, model } = {},
) {
  const { data } = await aiApi.post(`/api/manual-cases/${scanId}`, {
    additionalCases: additionalCases ?? null,
    force: force ?? false,
    provider: provider ?? null,
    model: model ?? null,
  });
  return data;
}

export async function getManualCases(scanId) {
  const { data } = await api.get(`/api/manual-cases/${scanId}`);
  return data;
}

// ─── Runner de ejecución manual (FASE 9) ────────────────────────────────────

/** Estado del runner: catálogo genérico fijo + items trackeados del scan. */
export async function getManualRun(scanId) {
  const { data } = await api.get(`/api/manual-cases/${scanId}/run`);
  return data; // { scanId, catalog, items }
}

/**
 * Upsert de un item del runner. `item` = { caseKey?, source, status?, notes?, payload? }.
 * Para crear un caso custom: { source: 'custom', payload: { title, category, priority, description } }.
 */
export async function saveManualRunItem(scanId, item) {
  const { data } = await api.put(`/api/manual-cases/${scanId}/run`, item);
  return data.item;
}

/** Borra un item del runner (caso custom completo, o el tracking de uno generic/ai). */
export async function deleteManualRunItem(scanId, caseKey) {
  await api.delete(`/api/manual-cases/${scanId}/run/${encodeURIComponent(caseKey)}`);
}

/** Upsert masivo de estados (aplicar sugerencias, marcar categoría, etc.). */
export async function bulkSaveManualRun(scanId, items) {
  const { data } = await api.put(`/api/manual-cases/${scanId}/run/bulk`, { items });
  return data.items;
}

/** Resetea el runner: borra todos los items trackeados del scan. */
export async function resetManualRun(scanId) {
  await api.delete(`/api/manual-cases/${scanId}/run`);
}

/** Lista las corridas archivadas (snapshots) del scan. */
export async function getManualRunSnapshots(scanId) {
  const { data } = await api.get(`/api/manual-cases/${scanId}/run/snapshots`);
  return data.snapshots;
}

/** Archiva la corrida actual como snapshot. Con reset=true limpia el runner. */
export async function createManualRunSnapshot(scanId, { label, reset, items }) {
  const { data } = await api.post(`/api/manual-cases/${scanId}/run/snapshots`, {
    label,
    reset: Boolean(reset),
    items,
  });
  return data.snapshot;
}

/** Borra una corrida archivada. */
export async function deleteManualRunSnapshot(scanId, snapshotId) {
  await api.delete(`/api/manual-cases/${scanId}/run/snapshots/${snapshotId}`);
}

// ─── Repositorio de casos de prueba (FASE 10) ───────────────────────────

/** Lista los SUTs (software bajo prueba) con cantidad de casos. */
export async function listSuts() {
  const { data } = await api.get('/api/repository/suts');
  return data.suts;
}

export async function createSut(payload) {
  const { data } = await api.post('/api/repository/suts', payload);
  return data.sut;
}

/** Devuelve { sut, testCases }. */
export async function getSut(sutId) {
  const { data } = await api.get(`/api/repository/suts/${sutId}`);
  return data;
}

export async function updateSut(sutId, patch) {
  const { data } = await api.patch(`/api/repository/suts/${sutId}`, patch);
  return data.sut;
}

export async function deleteSut(sutId) {
  await api.delete(`/api/repository/suts/${sutId}`);
}

export async function createTestCase(sutId, fields) {
  const { data } = await api.post(`/api/repository/suts/${sutId}/cases`, fields);
  return data.testCase;
}

export async function updateTestCase(caseId, patch) {
  const { data } = await api.patch(`/api/repository/cases/${caseId}`, patch);
  return data.testCase;
}

export async function deleteTestCase(caseId) {
  await api.delete(`/api/repository/cases/${caseId}`);
}

/** Aplica un lote de acciones (create/update/delete) — usado al confirmar el chatbot. */
export async function applyTestCaseActions(sutId, actions) {
  const { data } = await api.post(`/api/repository/suts/${sutId}/cases/apply`, { actions });
  return data.testCases;
}

/** Importa al SUT los casos manuales de un scan. */
export async function importCasesFromScan(sutId, scanId) {
  const { data } = await api.post(`/api/repository/suts/${sutId}/import-from-scan`, { scanId });
  return data; // { imported, testCases }
}

/** Chatbot del repositorio — devuelve { reply, actions, provider }. */
export async function chatWithRepo(sutId, { messages, provider, model }) {
  const { data } = await aiApi.post(`/api/repository/suts/${sutId}/chat`, {
    messages,
    provider: provider ?? null,
    model: model ?? null,
  });
  return data;
}

/** Trae casos del repositorio al runner de un scan. Devuelve { imported, items }. */
export async function importRepoCasesToRunner(scanId, caseIds) {
  const { data } = await api.post(`/api/manual-cases/${scanId}/run/import-repo`, { caseIds });
  return data;
}

// ─── AI exploratory testing ─────────────────────────────────────────────

/** Crea + encola una sesión exploratoria. Devuelve { session }. */
export async function createExploration(payload) {
  const { data } = await api.post('/api/explore', payload);
  return data.session;
}

/** Lista las sesiones del user (paginado). Devuelve { sessions, pagination }. */
export async function listExplorations({ page, pageSize } = {}) {
  const { data } = await api.get('/api/explore', { params: { page, pageSize } });
  return data;
}

export async function getExploration(id) {
  const { data } = await api.get(`/api/explore/${id}`);
  return data.session;
}

export async function cancelExploration(id) {
  const { data } = await api.post(`/api/explore/${id}/cancel`);
  return data;
}

export async function deleteExploration(id) {
  await api.delete(`/api/explore/${id}`);
}

// ─── Flow Runner determinista ───────────────────────────────────────────────

/** Crea un flujo. Devuelve { flow }. */
export async function createFlow(payload) {
  const { data } = await api.post('/api/flows', payload);
  return data.flow;
}

/** Lista flujos paginados. Devuelve { flows, pagination }. */
export async function listFlows({ page, pageSize } = {}) {
  const { data } = await api.get('/api/flows', { params: { page, pageSize } });
  return data;
}

/** Devuelve { flow, runs } (últimas corridas). */
export async function getFlow(id) {
  const { data } = await api.get(`/api/flows/${id}`);
  return data;
}

export async function updateFlow(id, patch) {
  const { data } = await api.put(`/api/flows/${id}`, patch);
  return data.flow;
}

export async function deleteFlow(id) {
  await api.delete(`/api/flows/${id}`);
}

/** Lanza una corrida del flujo. Devuelve { run }. */
export async function runFlow(id) {
  const { data } = await api.post(`/api/flows/${id}/run`);
  return data.run;
}

export async function listFlowRuns(id) {
  const { data } = await api.get(`/api/flows/${id}/runs`);
  return data.runs;
}

/** Detalle de una corrida (incluye stepResults). Devuelve { run }. */
export async function getFlowRun(runId) {
  const { data } = await api.get(`/api/flows/runs/${runId}`);
  return data.run;
}

export async function cancelFlowRun(runId) {
  const { data } = await api.post(`/api/flows/runs/${runId}/cancel`);
  return data;
}

// Flow Runner v2 ──────────────────────────────────────────────────────────

/** Exporta el flow a un framework. Devuelve { content, filename, language, framework }. */
export async function exportFlowScript(id, framework) {
  const { data } = await api.get(`/api/flows/${id}/export`, { params: { framework } });
  return data;
}

/** Crea un flow borrador desde una sesión exploratoria. Devuelve el flow. */
export async function createFlowFromExploration(sessionId) {
  const { data } = await api.post(`/api/flows/from-exploration/${sessionId}`);
  return data.flow;
}

export async function listFlowSchedules() {
  const { data } = await api.get('/api/flows/schedules');
  return data.schedules;
}

export async function createFlowSchedule(payload) {
  const { data } = await api.post('/api/flows/schedules', payload);
  return data.schedule;
}

export async function updateFlowSchedule(scheduleId, patch) {
  const { data } = await api.patch(`/api/flows/schedules/${scheduleId}`, patch);
  return data.schedule;
}

export async function deleteFlowSchedule(scheduleId) {
  await api.delete(`/api/flows/schedules/${scheduleId}`);
}

export async function runFlowScheduleNow(scheduleId) {
  const { data } = await api.post(`/api/flows/schedules/${scheduleId}/run`);
  return data.run;
}

// ─── Native app testing (#15) ───────────────────────────────────────────────

export async function listNativeProviders() {
  const { data } = await api.get('/api/native/providers');
  return data.providers;
}

export async function createNativeProvider(payload) {
  const { data } = await api.post('/api/native/providers', payload);
  return data.provider;
}

export async function updateNativeProvider(id, patch) {
  const { data } = await api.patch(`/api/native/providers/${id}`, patch);
  return data.provider;
}

export async function deleteNativeProvider(id) {
  await api.delete(`/api/native/providers/${id}`);
}

/** Test de conectividad del endpoint Appium. Devuelve { ok, status }. */
export async function testNativeProvider(id) {
  const { data } = await api.post(`/api/native/providers/${id}/test`);
  return data;
}

export async function listNativeFlows() {
  const { data } = await api.get('/api/native/flows');
  return data.flows;
}

export async function createNativeFlow(payload) {
  const { data } = await api.post('/api/native/flows', payload);
  return data.flow;
}

/** Devuelve { flow, runs }. */
export async function getNativeFlow(id) {
  const { data } = await api.get(`/api/native/flows/${id}`);
  return data;
}

export async function updateNativeFlow(id, patch) {
  const { data } = await api.put(`/api/native/flows/${id}`, patch);
  return data.flow;
}

export async function deleteNativeFlow(id) {
  await api.delete(`/api/native/flows/${id}`);
}

/** Lanza una corrida native. Devuelve { run }. */
export async function runNativeFlow(id) {
  const { data } = await api.post(`/api/native/flows/${id}/run`);
  return data.run;
}

/** Detalle de una corrida native (incluye stepResults). Devuelve el run. */
export async function getNativeFlowRun(runId) {
  const { data } = await api.get(`/api/native/runs/${runId}`);
  return data.run;
}

export async function cancelNativeFlowRun(runId) {
  const { data } = await api.post(`/api/native/runs/${runId}/cancel`);
  return data;
}

// ─── OWASP ZAP (#14) ────────────────────────────────────────────────────────

export async function getZapConfig() {
  const { data } = await api.get('/api/zap/config');
  return data; // { configured, config }
}

export async function saveZapConfig(payload) {
  const { data } = await api.put('/api/zap/config', payload);
  return data.config;
}

export async function deleteZapConfig() {
  await api.delete('/api/zap/config');
}

/** Test de conectividad del daemon ZAP. Devuelve { ok, version }. */
export async function testZapConfig(payload) {
  const { data } = await api.post('/api/zap/config/test', payload ?? {});
  return data;
}

export async function listZapScans() {
  const { data } = await api.get('/api/zap/scans');
  return data.scans;
}

export async function createZapScan(payload) {
  const { data } = await api.post('/api/zap/scans', payload);
  return data.scan;
}

export async function getZapScan(id) {
  const { data } = await api.get(`/api/zap/scans/${id}`);
  return data.scan;
}

export async function cancelZapScan(id) {
  const { data } = await api.post(`/api/zap/scans/${id}/cancel`);
  return data;
}

export async function deleteZapScan(id) {
  await api.delete(`/api/zap/scans/${id}`);
}

// ─── Scheduled scans (FASE 8.6) ─────────────────────────────────────────

export async function listSchedules() {
  const { data } = await api.get('/api/schedules');
  return data.schedules;
}

export async function createSchedule(payload) {
  const { data } = await api.post('/api/schedules', payload);
  return data;
}

export async function updateSchedule(id, patch) {
  const { data } = await api.patch(`/api/schedules/${id}`, patch);
  return data;
}

export async function deleteSchedule(id) {
  await api.delete(`/api/schedules/${id}`);
}

export async function runScheduleNow(id) {
  const { data } = await api.post(`/api/schedules/${id}/run`);
  return data;
}

export async function validateCronExpr(cron, timezone) {
  const { data } = await api.post('/api/schedules/validate-cron', { cron, timezone });
  return data;
}

// ─── Integración Jira (FASE 8.10) ───────────────────────────────────────

export async function getJiraConfig() {
  const { data } = await api.get('/api/integrations/jira');
  return data; // { configured, config }
}

export async function saveJiraConfig(payload) {
  const { data } = await api.put('/api/integrations/jira', payload);
  return data;
}

export async function deleteJiraConfig() {
  await api.delete('/api/integrations/jira');
}

export async function testJiraConnection(payload) {
  const { data } = await api.post('/api/integrations/jira/test', payload ?? {});
  return data; // { ok, user }
}

export async function listJiraProjects() {
  const { data } = await api.get('/api/integrations/jira/projects');
  return data.projects;
}

export async function listJiraIssues(scanId) {
  const { data } = await api.get('/api/integrations/jira/issues', { params: { scanId } });
  return data.issues;
}

export async function createJiraIssue(payload) {
  const { data } = await api.post('/api/integrations/jira/issue', payload);
  return data.issue;
}

/**
 * Descarga el reporte en json|html|pdf como archivo en el browser.
 * PDF se rutea por `aiApi` (timeout 180s) porque Playwright tarda en lanzar.
 */
export async function downloadReport(scanId, format) {
  const client = format === 'pdf' ? aiApi : api;
  const response = await client.get(`/api/report/${scanId}/export`, {
    params: { format },
    responseType: 'blob',
  });
  const blob = response.data;
  const filename = `qa-forge-report-${scanId}.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
