import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });
dotenv.config({ path: join(__dirname, '.env'), override: true });
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { initPocketBase } from './lib/pocketbase.js';
import { registerSocketHandlers } from './socket/index.js';

const PORT = process.env.SERVER_PORT || 3002;

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];

const app = express();
app.use(cors({ origin: corsOrigins }));
app.use(express.json());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
  },
});

const pb = initPocketBase();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

registerSocketHandlers(io, pb);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
