// Zustand store para el scan activo y sus results en tiempo real.

import { create } from 'zustand';

export const useScanStore = create((set) => ({
  scanId: null,
  url: null,
  status: 'idle', // idle | pending | running | completed | failed | cancelled
  stage: null,
  message: null,
  errorMessage: null,
  results: [],
  summary: null,
  startedAt: null,
  completedAt: null,

  startScan: ({ scanId, url, status, stage, message, errorMessage, startedAt, completedAt }) =>
    set({
      scanId,
      url,
      status: status ?? 'pending',
      stage: stage ?? 'queued',
      message: message ?? 'Encolando scan',
      errorMessage: errorMessage ?? null,
      results: [],
      summary: null,
      startedAt: startedAt ?? null,
      completedAt: completedAt ?? null,
    }),

  applyProgress: ({ stage, message }) =>
    set((state) => {
      // Si llega un stage 'cancelled' por progress, marcamos cancelled (no running).
      if (stage === 'cancelled') {
        return {
          status: 'cancelled',
          stage,
          message: message ?? state.message,
          completedAt: state.completedAt ?? new Date().toISOString(),
        };
      }
      // No degradamos un estado terminal.
      const isTerminal = ['completed', 'failed', 'cancelled'].includes(state.status);
      return {
        status: isTerminal ? state.status : 'running',
        stage: stage ?? state.stage,
        message: message ?? state.message,
        startedAt: state.startedAt ?? new Date().toISOString(),
      };
    }),

  appendResult: (result) =>
    set((state) => ({ results: [...state.results, result] })),

  markCompleted: (summary) =>
    set({
      status: 'completed',
      stage: 'completed',
      message: 'Scan completado',
      summary,
      completedAt: new Date().toISOString(),
    }),

  markFailed: (errorMessage) =>
    set((state) => {
      // Si el usuario canceló, no degradamos a "failed".
      if (state.status === 'cancelled') return state;
      return {
        status: 'failed',
        message: 'Scan falló',
        errorMessage,
        completedAt: new Date().toISOString(),
      };
    }),

  markCancelled: () =>
    set({
      status: 'cancelled',
      message: 'Scan cancelado',
      completedAt: new Date().toISOString(),
    }),

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
      startedAt: null,
      completedAt: null,
    }),
}));
