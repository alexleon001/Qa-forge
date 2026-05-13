// Entry point del backend de QA Forge — arranca Express + Socket.io + Bull worker.

import 'dotenv/config';
import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';

import { errorHandler, notFoundHandler } from './api/middlewares/error.middleware.js';
import { manualCasesRouter } from './api/routes/manualcases.routes.js';
import { reportRouter } from './api/routes/report.routes.js';
import { scanRouter } from './api/routes/scan.routes.js';
import { scriptsRouter } from './api/routes/scripts.routes.js';
import { startScanWorker } from './queue/scan.queue.js';
import { attachSocketServer } from './sockets/scan.socket.js';

const PORT = Number(process.env.PORT) || 3001;

// FRONTEND_URL acepta lista separada por coma. También cualquier subdominio
// *.vercel.app (preview deploys) si el flag de abajo está activo.
const FRONTEND_URLS = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW_VERCEL_PREVIEWS = process.env.ALLOW_VERCEL_PREVIEWS !== 'false';

function corsOrigin(origin, callback) {
  // Sin origin (curl, health checks, server-to-server) → permitir.
  if (!origin) return callback(null, true);
  if (FRONTEND_URLS.includes(origin)) return callback(null, true);
  if (ALLOW_VERCEL_PREVIEWS && /\.vercel\.app$/.test(new URL(origin).hostname)) {
    return callback(null, true);
  }
  return callback(new Error(`Origin ${origin} no permitido por CORS`));
}

const app = express();
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
});
attachSocketServer(io);

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'qa-forge-backend', timestamp: new Date().toISOString() });
});

app.use('/api/scan', scanRouter);
app.use('/api/report', reportRouter);
app.use('/api/scripts', scriptsRouter);
app.use('/api/manual-cases', manualCasesRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// Worker de Bull — corre en el mismo proceso por simplicidad en dev. En prod
// conviene separarlo (otro contenedor) usando el mismo módulo.
startScanWorker().catch((err) => {
  console.error('[index] No se pudo iniciar el scan worker:', err);
});

httpServer.listen(PORT, () => {
  console.log(`[qa-forge] Backend escuchando en http://localhost:${PORT}`);
  console.log(
    `[qa-forge] CORS permitido para: ${FRONTEND_URLS.join(', ')}${
      ALLOW_VERCEL_PREVIEWS ? ' + *.vercel.app' : ''
    }`,
  );
});
