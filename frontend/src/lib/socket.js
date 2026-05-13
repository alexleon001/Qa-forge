// Singleton de Socket.io para el frontend.

import { io } from 'socket.io-client';

// VITE_SOCKET_URL es opcional — por default usa el mismo host que la API.
const URL =
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:3001';

let socketRef = null;

export function getSocket() {
  if (!socketRef) {
    socketRef = io(URL, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socketRef;
}
