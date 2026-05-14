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
  { deviceProfile, mode, maxPages, loginConfig } = {},
) {
  const body = {
    url,
    deviceProfile: deviceProfile ?? null,
  };
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

export async function listScans() {
  const { data } = await api.get('/api/scan');
  return data.scans;
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

/**
 * Descarga el reporte en json|html como archivo en el browser.
 */
export async function downloadReport(scanId, format) {
  const response = await api.get(`/api/report/${scanId}/export`, {
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
