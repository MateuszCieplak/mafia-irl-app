import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import { setupLobbyStartedWithPhaseDetective, clearAssignRolesForTest } from './helpers/setupGame.js';
import {
  playFullNightFromDetective,
  playDayDeliberationAndVoteResolve,
  allPlayersSkipVote,
  advancePhase,
  submitVote,
  submitNightAction,
} from './helpers/factory.js';
import { expectEventMeta } from './helpers/eventMeta.js';

describe('8. Warunki zwycięstwa', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('8.1 Miasto wygrywa — 0 mafii po nocy', async () => {
    const { roomId, code, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(
      ctx.url,
    );

    const rp3 = ctx.pb._store.room_players.find((p) => p.room_id === roomId && p.user_id === 'p03');
    const rp4 = ctx.pb._store.room_players.find((p) => p.room_id === roomId && p.user_id === 'p04');
    await ctx.pb.collection('room_players').update(rp3.id, { eliminated_at: new Date().toISOString() });
    await ctx.pb.collection('room_players').update(rp4.id, { eliminated_at: new Date().toISOString() });

    let over;
    masterSocket.once('game_over', (p) => {
      over = p;
    });

    await playFullNightFromDetective(masterSocket, socketById, { det: 'p06', doc: 'p02' });

    expect(over.winner).toBe('town');
    expect(over.roles).toBeDefined();
    expectEventMeta(over, roomId, code);

    const room = ctx.pb._store.rooms.find((r) => r.id === roomId);
    expect(room.status).toBe('finished');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('8.2 Mafia wygrywa — równość lub przewaga mafii po zabójstwie nocnym', async () => {
    const { roomId, code, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(
      ctx.url,
    );

    for (const uid of ['p05', 'p06', 'p07', 'p08', 'p09', 'p10']) {
      const rp = ctx.pb._store.room_players.find((p) => p.room_id === roomId && p.user_id === uid);
      await ctx.pb.collection('room_players').update(rp.id, { eliminated_at: new Date().toISOString() });
    }

    let over;
    masterSocket.once('game_over', (p) => {
      over = p;
    });

    await playFullNightFromDetective(masterSocket, socketById, {
      det: 'p01',
      doc: 'p02',
      kill: 'p01',
    });

    expect(over.winner).toBe('mafia');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('8.3 game_over przed następną nocą po głosowaniu', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    for (const uid of ['p05', 'p06', 'p07', 'p08', 'p09']) {
      const rp = ctx.pb._store.room_players.find((p) => p.room_id === roomId && p.user_id === uid);
      await ctx.pb.collection('room_players').update(rp.id, { eliminated_at: new Date().toISOString() });
    }

    const gameOvers = [];
    masterSocket.on('game_over', (p) => gameOvers.push(p));

    await playFullNightFromDetective(masterSocket, socketById, { det: 'p01', doc: 'p02' });
    const dayRes = await playDayDeliberationAndVoteResolve(masterSocket, async () => {
      await submitVote(socketById.p01.socket, 'p10');
      await submitVote(socketById.p02.socket, 'p10');
      await submitVote(socketById.p03.socket, 'p10');
      await submitVote(socketById.p04.socket, 'p10');
      await submitVote(socketById.p10.socket, null);
    });

    expect(dayRes?.ok).toBe(true);
    expect(ctx.pb._store.rooms.find((r) => r.id === roomId)?.status).toBe('finished');
    expect(gameOvers.at(-1)?.winner).toBe('mafia');
    expect((await submitNightAction(socketById.p03.socket, 'p02')).error).toBe('game_finished');

    masterSocket.removeAllListeners('game_over');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('8.4 Po game_over advance_phase i głosy odrzucone', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    const rp3 = ctx.pb._store.room_players.find((p) => p.room_id === roomId && p.user_id === 'p03');
    const rp4 = ctx.pb._store.room_players.find((p) => p.room_id === roomId && p.user_id === 'p04');
    await ctx.pb.collection('room_players').update(rp3.id, { eliminated_at: new Date().toISOString() });
    await ctx.pb.collection('room_players').update(rp4.id, { eliminated_at: new Date().toISOString() });

    await playFullNightFromDetective(masterSocket, socketById, { det: 'p06', doc: 'p02' });

    expect((await advancePhase(masterSocket)).error).toBe('game_not_started');
    expect((await submitVote(socketById.p01.socket, 'p02')).error).toBe('game_finished');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });
});
