import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import { createRoom, joinPlayers, makePlayers } from './helpers/factory.js';
import { setupLobbyStartedWithPhaseDetective, clearAssignRolesForTest } from './helpers/setupGame.js';

describe('9. Rozłączenia', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('9.1 Gracz rozłącza się w lobby — usunięcie z room_players i player_left', async () => {
    // Use a short grace period in tests so we don't wait minutes.
    const { roomId, code, masterSocket } = await createRoom(ctx.url, {
      min_players: 4,
      lobby_disconnect_grace_ms: 50,
    });
    const sockets = await joinPlayers(ctx.url, code, makePlayers(3));

    const left = [];
    masterSocket.on('player_left', (p) => left.push(p));

    sockets[1].socket.disconnect();
    await new Promise((r) => setTimeout(r, 120));

    expect(left.some((e) => e.userId === sockets[1].user.id)).toBe(true);
    const inDb = ctx.pb._store.room_players.filter((p) => p.room_id === roomId);
    expect(inDb).toHaveLength(3);

    masterSocket.disconnect();
    sockets[0].socket.disconnect();
    sockets[2].socket.disconnect();
  });

  it('9.2 Rozłączenie w grze — socketId null, room_players_sync', async () => {
    const { masterSocket, sockets } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    const syncs = [];
    masterSocket.on('room_players_sync', (p) => syncs.push(p));

    sockets[0].socket.disconnect();
    await new Promise((r) => setTimeout(r, 80));

    expect(syncs.length).toBeGreaterThanOrEqual(1);
    const p = syncs.at(-1).players.find((x) => x.id === sockets[0].user.id);
    expect(p.online).toBe(false);

    masterSocket.disconnect();
    for (let i = 1; i < sockets.length; i++) sockets[i].socket.disconnect();
    clearAssignRolesForTest();
  });

  it.skip('9.6 Reconnect w trakcie gry — wymaga dedykowanego handlera (join_room blokuje status != lobby)', () => {});
});
