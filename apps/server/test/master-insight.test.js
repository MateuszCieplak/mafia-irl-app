import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import {
  setupLobbyStartedWithPhaseDetective,
  clearAssignRolesForTest,
  defaultRoleOrder,
} from './helpers/setupGame.js';
import { setAssignRolesForTest } from '../game/roles.js';
import {
  advancePhase,
  submitNightAction,
  submitVote,
  createRoom,
  joinPlayers,
  makePlayers,
  startGame,
} from './helpers/factory.js';

function collectInsights(masterSocket) {
  const insights = [];
  masterSocket.on('master_game_insight', (data) => insights.push(data));
  return insights;
}

describe('11. Master game insight — live podgląd', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('roles_assigned przy start_game', async () => {
    const order = defaultRoleOrder();
    setAssignRolesForTest((ids) => Object.fromEntries(ids.map((id, i) => [id, order[i]])));
    const { roomId, code, masterSocket } = await createRoom(ctx.url, { min_players: 10 });
    const sockets = await joinPlayers(ctx.url, code, makePlayers(10));

    const insights = collectInsights(masterSocket);
    await startGame(masterSocket);
    await new Promise((r) => setTimeout(r, 50));

    const rolesEntry = insights.find((e) => e.kind === 'roles_assigned');
    expect(rolesEntry).toBeDefined();
    expect(rolesEntry.roles['p01']).toBe('detective');
    expect(rolesEntry.roles['p03']).toBe('mafia');
    expect(rolesEntry.roomId).toBe(roomId);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('night_detective insight po akcji detektywa', async () => {
    const { roomId, masterSocket, sockets, socketById } =
      await setupLobbyStartedWithPhaseDetective(ctx.url);
    const insights = collectInsights(masterSocket);

    await submitNightAction(socketById.p01.socket, 'p07');
    await new Promise((r) => setTimeout(r, 50));

    const det = insights.find((e) => e.kind === 'night_detective');
    expect(det).toBeDefined();
    expect(det.actorId).toBe('p01');
    expect(det.targetId).toBe('p07');
    expect(det.isMafia).toBe(false);
    expect(det.roomId).toBe(roomId);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('night_doctor insight po akcji lekarza', async () => {
    const { roomId, masterSocket, sockets, socketById } =
      await setupLobbyStartedWithPhaseDetective(ctx.url);
    const insights = collectInsights(masterSocket);

    await submitNightAction(socketById.p01.socket, 'p06');
    await advancePhase(masterSocket);

    await submitNightAction(socketById.p02.socket, 'p05');
    await new Promise((r) => setTimeout(r, 50));

    const doc = insights.find((e) => e.kind === 'night_doctor');
    expect(doc).toBeDefined();
    expect(doc.actorId).toBe('p02');
    expect(doc.targetId).toBe('p05');
    expect(doc.roomId).toBe(roomId);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('night_mafia insight — progress + konsensus', async () => {
    const { roomId, masterSocket, sockets, socketById } =
      await setupLobbyStartedWithPhaseDetective(ctx.url);
    const insights = collectInsights(masterSocket);

    await submitNightAction(socketById.p01.socket, 'p06');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p02.socket, 'p05');
    await advancePhase(masterSocket);

    await submitNightAction(socketById.p03.socket, 'p07');
    await new Promise((r) => setTimeout(r, 50));

    const first = insights.filter((e) => e.kind === 'night_mafia');
    expect(first.length).toBeGreaterThanOrEqual(1);
    const partial = first[0];
    expect(partial.consensus).toBe(false);
    expect(partial.votes['p03']).toBe('p07');
    expect(partial.finalKillTarget).toBeNull();

    await submitNightAction(socketById.p04.socket, 'p07');
    await new Promise((r) => setTimeout(r, 50));

    const all = insights.filter((e) => e.kind === 'night_mafia');
    const final = all[all.length - 1];
    expect(final.consensus).toBe(true);
    expect(final.finalKillTarget).toBe('p07');
    expect(final.votes['p03']).toBe('p07');
    expect(final.votes['p04']).toBe('p07');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('day_vote insight po głosie', async () => {
    const { roomId, masterSocket, sockets, socketById } =
      await setupLobbyStartedWithPhaseDetective(ctx.url);
    const insights = collectInsights(masterSocket);

    await submitNightAction(socketById.p01.socket, 'p06');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p02.socket, 'p05');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p03.socket, 'p07');
    await submitNightAction(socketById.p04.socket, 'p07');
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    await submitVote(socketById.p01.socket, 'p06');
    await submitVote(socketById.p02.socket, null);
    await new Promise((r) => setTimeout(r, 50));

    const votes = insights.filter((e) => e.kind === 'day_vote');
    expect(votes.length).toBe(2);
    expect(votes[0].voterId).toBe('p01');
    expect(votes[0].targetId).toBe('p06');
    expect(votes[1].voterId).toBe('p02');
    expect(votes[1].targetId).toBeNull();

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });
});
