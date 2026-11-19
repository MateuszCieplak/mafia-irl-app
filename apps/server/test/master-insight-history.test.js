import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import { setupLobbyStartedWithPhaseDetective, clearAssignRolesForTest } from './helpers/setupGame.js';
import {
  advancePhase,
  submitNightAction,
  getGameState,
  connectTestClient,
  emitAck,
  USER_MASTER,
} from './helpers/factory.js';

/** Odświeżenie strony mastera = nowe połączenie + join_room + get_game_state. */
async function refreshMaster(url, oldSocket, code) {
  oldSocket.disconnect();
  await new Promise((r) => setTimeout(r, 30));
  const socket = await connectTestClient(url, USER_MASTER);
  await emitAck(socket, 'join_room', { code });
  return socket;
}

describe('Podgląd live mastera — historia po odświeżeniu', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('get_game_state oddaje masterowi całą historię, także z czasu gdy był offline', async () => {
    const { code, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    expect((await submitNightAction(socketById.p01.socket, 'p03')).ok).toBe(true);
    await advancePhase(masterSocket); // night_doctor
    expect((await submitNightAction(socketById.p02.socket, 'p05')).ok).toBe(true);
    await advancePhase(masterSocket); // night_mafia

    // Master zamyka stronę; w tym czasie mafia działa.
    masterSocket.disconnect();
    await new Promise((r) => setTimeout(r, 30));
    expect((await submitNightAction(socketById.p03.socket, 'p06')).ok).toBe(true);

    const master = await refreshMaster(ctx.url, masterSocket, code);
    const state = await getGameState(master);
    expect(state.ok).toBe(true);
    const kinds = state.insightLog.map((e) => e.kind);
    expect(kinds).toEqual(['roles_assigned', 'night_detective', 'night_doctor', 'night_mafia']);
    expect(state.insightLog.map((e) => e.seq)).toEqual([1, 2, 3, 4]);

    // Nowe wpisy po odświeżeniu dalej idą eventem, z kolejnym seq.
    const live = [];
    master.on('master_game_insight', (e) => live.push(e));
    expect((await submitNightAction(socketById.p04.socket, 'p06')).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(live.map((e) => e.seq)).toEqual([5]);
    expect((await getGameState(master)).insightLog).toHaveLength(5);

    // Zwykły gracz nie widzi historii mastera (role, akcje nocne).
    expect((await getGameState(socketById.p05.socket)).insightLog).toBeUndefined();

    master.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('powrót do pokoju czyści historię przed kolejną grą', async () => {
    const { masterSocket, sockets } = await setupLobbyStartedWithPhaseDetective(ctx.url);
    expect((await getGameState(masterSocket)).insightLog.length).toBeGreaterThan(0);
    expect((await emitAck(masterSocket, 'end_game')).ok).toBe(true);
    expect((await emitAck(masterSocket, 'return_to_room')).ok).toBe(true);
    expect((await getGameState(masterSocket)).insightLog).toEqual([]);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });
});
