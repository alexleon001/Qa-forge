// Wrapper sobre Socket.io para emitir eventos de progreso de scans.
// El cliente se suscribe a un scanId con SOCKET_EVENT.SUBSCRIBE; los eventos
// del scan se emiten al room `scan:<id>` para no inundar otros clientes.

import { SOCKET_EVENT } from '../../../shared/constants.js';

let ioRef = null;

export function attachSocketServer(io) {
  ioRef = io;

  io.on('connection', (socket) => {
    socket.on(SOCKET_EVENT.SUBSCRIBE, (scanId) => {
      if (typeof scanId === 'string' && scanId.length > 0) {
        socket.join(`scan:${scanId}`);
      }
    });

    socket.on(SOCKET_EVENT.UNSUBSCRIBE, (scanId) => {
      if (typeof scanId === 'string' && scanId.length > 0) {
        socket.leave(`scan:${scanId}`);
      }
    });

    socket.on(SOCKET_EVENT.EXPLORE_SUBSCRIBE, (sessionId) => {
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        socket.join(`explore:${sessionId}`);
      }
    });

    socket.on(SOCKET_EVENT.EXPLORE_UNSUBSCRIBE, (sessionId) => {
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        socket.leave(`explore:${sessionId}`);
      }
    });

    socket.on(SOCKET_EVENT.FLOW_SUBSCRIBE, (runId) => {
      if (typeof runId === 'string' && runId.length > 0) {
        socket.join(`flow:${runId}`);
      }
    });

    socket.on(SOCKET_EVENT.FLOW_UNSUBSCRIBE, (runId) => {
      if (typeof runId === 'string' && runId.length > 0) {
        socket.leave(`flow:${runId}`);
      }
    });

    socket.on(SOCKET_EVENT.NATIVE_SUBSCRIBE, (runId) => {
      if (typeof runId === 'string' && runId.length > 0) {
        socket.join(`native:${runId}`);
      }
    });

    socket.on(SOCKET_EVENT.NATIVE_UNSUBSCRIBE, (runId) => {
      if (typeof runId === 'string' && runId.length > 0) {
        socket.leave(`native:${runId}`);
      }
    });

    socket.on(SOCKET_EVENT.ZAP_SUBSCRIBE, (scanId) => {
      if (typeof scanId === 'string' && scanId.length > 0) {
        socket.join(`zap:${scanId}`);
      }
    });

    socket.on(SOCKET_EVENT.ZAP_UNSUBSCRIBE, (scanId) => {
      if (typeof scanId === 'string' && scanId.length > 0) {
        socket.leave(`zap:${scanId}`);
      }
    });
  });
}

function room(scanId) {
  return `scan:${scanId}`;
}

function exploreRoom(sessionId) {
  return `explore:${sessionId}`;
}

function flowRoom(runId) {
  return `flow:${runId}`;
}

function nativeRoom(runId) {
  return `native:${runId}`;
}

function zapRoom(scanId) {
  return `zap:${scanId}`;
}

export function emitProgress(scanId, payload) {
  ioRef?.to(room(scanId)).emit(SOCKET_EVENT.SCAN_PROGRESS, { scanId, ...payload });
}

export function emitResult(scanId, result) {
  ioRef?.to(room(scanId)).emit(SOCKET_EVENT.SCAN_RESULT, { scanId, result });
}

export function emitCompleted(scanId, summary) {
  ioRef?.to(room(scanId)).emit(SOCKET_EVENT.SCAN_COMPLETED, { scanId, summary });
}

export function emitFailed(scanId, errorMessage) {
  ioRef?.to(room(scanId)).emit(SOCKET_EVENT.SCAN_FAILED, { scanId, errorMessage });
}

// ─── AI exploratory testing ─────────────────────────────────────────────────

export function emitExploreProgress(sessionId, payload) {
  ioRef?.to(exploreRoom(sessionId)).emit(SOCKET_EVENT.EXPLORE_PROGRESS, { sessionId, ...payload });
}

export function emitExploreStep(sessionId, step) {
  ioRef?.to(exploreRoom(sessionId)).emit(SOCKET_EVENT.EXPLORE_STEP, { sessionId, step });
}

export function emitExploreFinding(sessionId, finding) {
  ioRef?.to(exploreRoom(sessionId)).emit(SOCKET_EVENT.EXPLORE_FINDING, { sessionId, finding });
}

export function emitExploreCompleted(sessionId, summary) {
  ioRef?.to(exploreRoom(sessionId)).emit(SOCKET_EVENT.EXPLORE_COMPLETED, { sessionId, summary });
}

export function emitExploreFailed(sessionId, errorMessage) {
  ioRef?.to(exploreRoom(sessionId)).emit(SOCKET_EVENT.EXPLORE_FAILED, { sessionId, errorMessage });
}

// ─── Flow Runner determinista ───────────────────────────────────────────────

export function emitFlowProgress(runId, payload) {
  ioRef?.to(flowRoom(runId)).emit(SOCKET_EVENT.FLOW_PROGRESS, { runId, ...payload });
}

export function emitFlowStep(runId, step) {
  ioRef?.to(flowRoom(runId)).emit(SOCKET_EVENT.FLOW_STEP, { runId, step });
}

export function emitFlowCompleted(runId, result) {
  ioRef?.to(flowRoom(runId)).emit(SOCKET_EVENT.FLOW_COMPLETED, { runId, ...result });
}

export function emitFlowFailed(runId, errorMessage) {
  ioRef?.to(flowRoom(runId)).emit(SOCKET_EVENT.FLOW_FAILED, { runId, errorMessage });
}

// ─── Native app testing (#15) ───────────────────────────────────────────────

export function emitNativeProgress(runId, payload) {
  ioRef?.to(nativeRoom(runId)).emit(SOCKET_EVENT.NATIVE_PROGRESS, { runId, ...payload });
}

export function emitNativeStep(runId, step) {
  ioRef?.to(nativeRoom(runId)).emit(SOCKET_EVENT.NATIVE_STEP, { runId, step });
}

export function emitNativeCompleted(runId, result) {
  ioRef?.to(nativeRoom(runId)).emit(SOCKET_EVENT.NATIVE_COMPLETED, { runId, ...result });
}

export function emitNativeFailed(runId, errorMessage) {
  ioRef?.to(nativeRoom(runId)).emit(SOCKET_EVENT.NATIVE_FAILED, { runId, errorMessage });
}

// ─── OWASP ZAP (#14) ────────────────────────────────────────────────────────

export function emitZapProgress(scanId, payload) {
  ioRef?.to(zapRoom(scanId)).emit(SOCKET_EVENT.ZAP_PROGRESS, { scanId, ...payload });
}

export function emitZapCompleted(scanId, result) {
  ioRef?.to(zapRoom(scanId)).emit(SOCKET_EVENT.ZAP_COMPLETED, { scanId, ...result });
}

export function emitZapFailed(scanId, errorMessage) {
  ioRef?.to(zapRoom(scanId)).emit(SOCKET_EVENT.ZAP_FAILED, { scanId, errorMessage });
}
