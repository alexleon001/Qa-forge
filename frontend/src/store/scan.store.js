// Zustand store para el scan activo y sus results en tiempo real.

import { create } from 'zustand';

export const useScanStore = create((set) => ({
  scanId: null,
  url: null,
  status: 'idle', // idle | pending | running | completed | failed
  stage: null,
  message: null,
  errorMessage: null,
  results: [],
  summary: null,

  startScan: ({ scanId, url, status }) =>
    set({
      scanId,
      url,
      status: status ?? 'pending',
      stage: 'queued',
      message: 'Encolando scan',
      errorMessage: null,
      results: [],
      summary: null,
    }),

  applyProgress: ({ stage, message }) =>
    set((state) => ({
      status: state.status === 'completed' || state.status === 'failed' ? state.status : 'running',
      stage: stage ?? state.stage,
      message: message ?? state.message,
    })),

  appendResult: (result) =>
    set((state) => ({ results: [...state.results, result] })),

  markCompleted: (summary) =>
    set({ status: 'completed', stage: 'completed', message: 'Scan completado', summary }),

  markFailed: (errorMessage) =>
    set({ status: 'failed', message: 'Scan falló', errorMessage }),

  reset: () =>
    set({
      scanId: null,
      url: null,
      status: 'idle',
      stage: null,
      message: null,
      errorMessage: null,
      results: [],
      summary: null,
    }),
}));
