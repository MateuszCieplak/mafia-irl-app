import { createServer } from 'http';
import { Server } from 'socket.io';
import { registerSocketHandlers } from '../../socket/index.js';
import { createMockPocketBase } from '../mockPocketBase.js';
import { rooms } from '../../game/state.js';
import { presence } from '../../game/presence.js';
import { clearAssignRolesForTest } from '../../game/roles.js';

process.env.MAFIA_TEST_AUTH = '1';

export function resetInMemoryGameState() {
  rooms.clear();
  presence.clear();
  clearAssignRolesForTest();
}

/**
 * Uruchamia prawdziwy Socket.io + handlery z mockiem PocketBase (izolacja jak kolekcje test_* w pamięci).
 */
export async function startTestServer() {
  const pb = createMockPocketBase();
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket'],
  });
  registerSocketHandlers(io, pb);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  const url = `http://127.0.0.1:${port}`;
  return { httpServer, io, pb, url };
}

export async function stopTestServer(ctx) {
  if (!ctx) return;
  await new Promise((resolve) => {
    ctx.io.close(() => resolve());
  });
  await new Promise((resolve) => {
    ctx.httpServer.close(() => resolve());
  });
}
