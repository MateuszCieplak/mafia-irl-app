import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import { setupLobbyStartedWithPhaseDetective, clearAssignRolesForTest } from './helpers/setupGame.js';
import {
  playFullNightFromDetective,
  playDayDeliberationAndVoteResolve,
  allPlayersSkipVote,
  allLivingPlayersSkipVote,
  advancePhase,
  submitVote,
  emitAck,
} from './helpers/factory.js';
/** Druga faza day_vote: najpierw noc z eliminacją p05, dzień skip, druga noc bez kill, potem deliberacja→głosowanie. */
async function reachDayVoteAfterEliminatingP05(ctx, roomSettings = {}) {
  const { roomId, code, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(
    ctx.url,
    roomSettings,
  );
  await playFullNightFromDetective(masterSocket, socketById, {
    det: 'p07',
    doc: 'p02',
    kill: 'p05',
  });
  await playDayDeliberationAndVoteResolve(masterSocket, async () =>
    allLivingPlayersSkipVote(sockets, ctx.pb, roomId),
  );
  /* Inna osoba niż pierwsza noc (p02), bo doctor_repeat_protect: false. */
  await playFullNightFromDetective(masterSocket, socketById, { det: 'p06', doc: 'p03' });
  return { roomId, code, masterSocket, sockets, socketById };
}

describe('6. Dzień — deliberacja', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('6.1 Czat dzienny wyłączony w trakcie gry (tylko lobby + mafia noc)', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);
    await playFullNightFromDetective(masterSocket, socketById, {
      det: 'p08',
      doc: 'p03',
      kill: 'p05',
    });
    await advancePhase(masterSocket);

    expect(
      (await emitAck(socketById.p06.socket, 'chat_message', { channel: 'day', body: 'ok' })).error,
    ).toBe('channel_disabled');
    expect(
      (await emitAck(socketById.p05.socket, 'chat_message', { channel: 'day', body: 'no' })).error,
    ).toBe('channel_disabled');

    const m = await emitAck(masterSocket, 'chat_message', { channel: 'day', body: 'narracja' });
    expect(m.error).toBe('channel_disabled');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('6.2 Głos przed otwarciem głosowania — odrzucony', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);
    await playFullNightFromDetective(masterSocket, socketById, { det: 'p06', doc: 'p02' });
    expect((await submitVote(socketById.p01.socket, 'p03')).error).toBe('wrong_phase');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });
});

describe('7. Dzień — głosowanie (9 żywych po eliminacji p05)', () => {
  let ctx;

  function eliminatedCount(roomId) {
    return ctx.pb._store.room_players.filter((p) => p.room_id === roomId && p.eliminated_at).length;
  }

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('7.1 Większość na gracza — eliminacja', async () => {
    const { roomId, masterSocket, sockets, socketById } = await reachDayVoteAfterEliminatingP05(ctx);
    const beforeElim = eliminatedCount(roomId);
    await advancePhase(masterSocket);

    await submitVote(socketById.p01.socket, 'p02');
    await submitVote(socketById.p03.socket, 'p02');
    await submitVote(socketById.p04.socket, 'p02');
    await submitVote(socketById.p07.socket, 'p02');
    await submitVote(socketById.p08.socket, 'p02');
    await submitVote(socketById.p06.socket, 'p06');
    await submitVote(socketById.p09.socket, 'p06');
    await submitVote(socketById.p10.socket, 'p06');
    await submitVote(socketById.p02.socket, 'p06');

    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    expect(eliminatedCount(roomId)).toBe(beforeElim + 1);
    const rp2 = ctx.pb._store.room_players.find((p) => p.user_id === 'p02' && p.room_id === roomId);
    expect(rp2.eliminated_at).toBeTruthy();

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('7.1b Werdykt głosowania jest w get_game_state przez całą fazę day_resolve', async () => {
    const { masterSocket, sockets, socketById } = await reachDayVoteAfterEliminatingP05(ctx);
    await advancePhase(masterSocket);

    for (const id of ['p01', 'p03', 'p04', 'p07', 'p08']) {
      await submitVote(socketById[id].socket, 'p02');
    }
    for (const id of ['p06', 'p09', 'p10', 'p02']) {
      await submitVote(socketById[id].socket, 'p06');
    }
    await advancePhase(masterSocket);

    const during = await emitAck(socketById.p07.socket, 'get_game_state');
    expect(during.phase).toBe('day_resolve');
    expect(during.phaseResult).toEqual({
      kind: 'vote',
      eliminatedPlayerId: 'p02',
      outcome: 'eliminated',
    });

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('7.2 Większość skip — brak eliminacji', async () => {
    const { roomId, masterSocket, sockets, socketById } = await reachDayVoteAfterEliminatingP05(ctx);
    const beforeElim = eliminatedCount(roomId);
    await advancePhase(masterSocket);

    for (const id of ['p01', 'p02', 'p03', 'p04', 'p06']) {
      await submitVote(socketById[id].socket, null);
    }
    await submitVote(socketById.p07.socket, 'p02');
    await submitVote(socketById.p08.socket, 'p02');
    await submitVote(socketById.p09.socket, 'p02');
    await submitVote(socketById.p10.socket, 'p02');

    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    expect(eliminatedCount(roomId)).toBe(beforeElim);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('7.4 Remis dwóch graczy — brak eliminacji', async () => {
    const { roomId, masterSocket, sockets, socketById } = await reachDayVoteAfterEliminatingP05(ctx);
    const beforeElim = eliminatedCount(roomId);
    await advancePhase(masterSocket);

    await submitVote(socketById.p01.socket, 'p02');
    await submitVote(socketById.p03.socket, 'p02');
    await submitVote(socketById.p04.socket, 'p02');
    await submitVote(socketById.p06.socket, 'p02');
    await submitVote(socketById.p07.socket, 'p06');
    await submitVote(socketById.p08.socket, 'p06');
    await submitVote(socketById.p09.socket, 'p06');
    await submitVote(socketById.p10.socket, 'p06');
    await submitVote(socketById.p02.socket, null);

    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    expect(eliminatedCount(roomId)).toBe(beforeElim);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('7.5 Remis trójstronny — brak eliminacji', async () => {
    const { roomId, masterSocket, sockets, socketById } = await reachDayVoteAfterEliminatingP05(ctx);
    const beforeElim = eliminatedCount(roomId);
    await advancePhase(masterSocket);

    await submitVote(socketById.p01.socket, 'p02');
    await submitVote(socketById.p03.socket, 'p02');
    await submitVote(socketById.p04.socket, 'p02');
    await submitVote(socketById.p06.socket, 'p06');
    await submitVote(socketById.p07.socket, 'p06');
    await submitVote(socketById.p08.socket, 'p06');
    await submitVote(socketById.p09.socket, null);
    await submitVote(socketById.p10.socket, null);
    await submitVote(socketById.p02.socket, null);

    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    expect(eliminatedCount(roomId)).toBe(beforeElim);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('7.6 self_vote: false — odrzucenie głosu na siebie', async () => {
    const { masterSocket, sockets, socketById } = await reachDayVoteAfterEliminatingP05(ctx, {
      self_vote: false,
    });
    await advancePhase(masterSocket);

    const r = await submitVote(socketById.p02.socket, 'p02');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('self_vote_forbidden');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('7.7 Podwójny głos — drugi odrzucony', async () => {
    const { masterSocket, sockets, socketById } = await reachDayVoteAfterEliminatingP05(ctx);
    await advancePhase(masterSocket);

    await submitVote(socketById.p01.socket, 'p02');
    const r2 = await submitVote(socketById.p01.socket, 'p06');
    expect(r2.error).toBe('already_voted');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('7.8 Wszyscy skip — brak eliminacji', async () => {
    const { roomId, masterSocket, sockets, socketById } = await reachDayVoteAfterEliminatingP05(ctx);
    const beforeElim = eliminatedCount(roomId);
    await advancePhase(masterSocket);

    for (const { socket, user } of sockets) {
      if (user.id === 'p05') continue;
      await submitVote(socket, null);
    }

    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    expect(eliminatedCount(roomId)).toBe(beforeElim);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('7.9 Jeden głos na gracza, reszta skip — brak eliminacji (skip dominuje)', async () => {
    const { roomId, masterSocket, sockets, socketById } = await reachDayVoteAfterEliminatingP05(ctx);
    const beforeElim = eliminatedCount(roomId);
    await advancePhase(masterSocket);

    await submitVote(socketById.p01.socket, 'p03');
    for (const id of ['p02', 'p04', 'p06', 'p07', 'p08', 'p09', 'p10']) {
      await submitVote(socketById[id].socket, null);
    }

    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    expect(eliminatedCount(roomId)).toBe(beforeElim);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });
});
