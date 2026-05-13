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
  });
}

function room(scanId) {
  return `scan:${scanId}`;
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
