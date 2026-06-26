import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import {
  setupLobbyStartedWithPhaseDetective,
  setupGameStartedBeforeFirstPhaseAdvance,
  setupAtNightMafia,
  clearAssignRolesForTest,
} from './helpers/setupGame.js';
import {
  advancePhase,
  submitNightAction,
  emitAck,
  playFullNightFromDetective,
  playDayDeliberationAndVoteResolve,
  allLivingPlayersSkipVote,
} from './helpers/factory.js';
import { expectEventMeta } from './helpers/eventMeta.js';

function teardown(masterSocket, sockets) {
  masterSocket.disconnect();
  for (const { socket } of sockets) socket.disconnect();
}

describe('3. Noc — lekarz', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('3.1 Tylko lekarz dostaje prompt; ochrona zapisana (callback ok)', async () => {
    const { roomId, code, masterSocket, sockets, socketById } = await setupGameStartedBeforeFirstPhaseAdvance(
      ctx.url,
    );
    const prompts = {};
    for (const { socket, user } of sockets) {
      socket.on('night_action_prompt', (p) => {
        if (p.phase === 'night_doctor') prompts[user.id] = p;
      });
    }
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);
    await new Promise((r) => setTimeout(r, 25));

    expect(Object.keys(prompts)).toEqual(['p02']);
    expectEventMeta(prompts.p02, roomId, code);

    const r = await submitNightAction(socketById.p02.socket, 'p03');
    expect(r.ok).toBe(true);

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('3.2 Ochrona blokuje zabójstwo; następna noc — eliminacja bez ochrony na cel', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    let night1;
    masterSocket.once('night_resolved', (p) => {
      night1 = p;
    });
    const r1 = await playFullNightFromDetective(masterSocket, socketById, {
      det: 'p06',
      doc: 'p05',
      kill: 'p05',
    });
    expect(r1.ok).toBe(true);
    expect(night1.eliminatedPlayerId).toBeNull();

    const p5alive = ctx.pb._store.room_players.find((p) => p.user_id === 'p05' && p.room_id === roomId);
    expect(p5alive.eliminated_at).toBeFalsy();

    await playDayDeliberationAndVoteResolve(masterSocket, async () =>
      allLivingPlayersSkipVote(sockets, ctx.pb, roomId),
    );

    let night2;
    masterSocket.once('night_resolved', (p) => {
      night2 = p;
    });
    const r2 = await playFullNightFromDetective(masterSocket, socketById, {
      det: 'p07',
      doc: 'p03',
      kill: 'p06',
    });
    expect(r2.ok).toBe(true);
    expect(night2.eliminatedPlayerId).toBe('p06');

    const p6 = ctx.pb._store.room_players.find((p) => p.user_id === 'p06' && p.room_id === roomId);
    expect(p6.eliminated_at).toBeTruthy();

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('3.3 doctor_can_self_protect: false — odrzucenie ochrony siebie', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url, {
      doctor_can_self_protect: false,
    });
    await advancePhase(masterSocket);

    const r = await submitNightAction(socketById.p02.socket, 'p02');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('cannot_self_protect');

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('3.3b doctor_can_self_protect: true — akceptacja', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url, {
      doctor_can_self_protect: true,
    });
    await advancePhase(masterSocket);

    const r = await submitNightAction(socketById.p02.socket, 'p02');
    expect(r.ok).toBe(true);

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('3.3c doctor_repeat_protect: false — ta sama osoba co poprzednia noc', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url, {
      doctor_repeat_protect: false,
    });

    await playFullNightFromDetective(masterSocket, socketById, {
      det: 'p08',
      doc: 'p05',
      kill: 'p06',
    });
    await playDayDeliberationAndVoteResolve(masterSocket, async () =>
      allLivingPlayersSkipVote(sockets, ctx.pb, roomId),
    );

    await submitNightAction(socketById.p01.socket, 'p09');
    await advancePhase(masterSocket);
    const r = await submitNightAction(socketById.p02.socket, 'p05');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('repeat_protect_forbidden');

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('3.3d doctor_repeat_protect: true — powtórna ochrona dozwolona', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url, {
      doctor_repeat_protect: true,
    });

    await playFullNightFromDetective(masterSocket, socketById, {
      det: 'p08',
      doc: 'p05',
      kill: 'p06',
    });
    await playDayDeliberationAndVoteResolve(masterSocket, async () =>
      allLivingPlayersSkipVote(sockets, ctx.pb, roomId),
    );

    await submitNightAction(socketById.p01.socket, 'p09');
    await advancePhase(masterSocket);
    const r = await submitNightAction(socketById.p02.socket, 'p05');
    expect(r.ok).toBe(true);

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('3.4 Odmowa akcji lekarza dla obywatela / mafii / detektywa', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);
    await advancePhase(masterSocket);

    expect((await submitNightAction(socketById.p05.socket, 'p03')).error).toBe('no_action');
    expect((await submitNightAction(socketById.p03.socket, 'p05')).error).toBe('wrong_phase');
    expect((await submitNightAction(socketById.p01.socket, 'p05')).error).toBe('wrong_phase');

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });
});

describe('4. Noc — mafia', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('4.1 Chat mafia_night — tylko mafia otrzymuje wiadomość', async () => {
    const { masterSocket, sockets, socketById } = await setupAtNightMafia(ctx.url);

    const received = { p03: 0, p05: 0 };
    socketById.p03.socket.on('chat_message', () => {
      received.p03++;
    });
    socketById.p05.socket.on('chat_message', () => {
      received.p05++;
    });

    const r = await emitAck(socketById.p03.socket, 'chat_message', {
      channel: 'mafia_night',
      body: 'cel p05',
    });
    expect(r.ok).toBe(true);
    await new Promise((x) => setTimeout(x, 30));
    expect(received.p03).toBeGreaterThanOrEqual(1);
    expect(received.p05).toBe(0);

    const cit = await emitAck(socketById.p05.socket, 'chat_message', {
      channel: 'mafia_night',
      body: 'hack',
    });
    expect(cit.ok).toBe(false);
    expect(cit.error).toBe('forbidden');

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('4.2 Konsensus — różne cele, potem zgoda na ten sam cel', async () => {
    const { masterSocket, sockets, socketById } = await setupAtNightMafia(ctx.url);

    const updates = [];
    socketById.p04.socket.on('mafia_vote_update', (u) => updates.push(u));

    await submitNightAction(socketById.p03.socket, 'p04');
    await submitNightAction(socketById.p04.socket, 'p07');

    const mid = updates.at(-1);
    expect(mid.consensus).toBe(false);
    expect(mid.waitingForConsensus).toBe(true);

    await submitNightAction(socketById.p03.socket, 'p07');
    const r = await submitNightAction(socketById.p04.socket, 'p07');
    expect(r.ok).toBe(true);
    expect(r.consensus).toBe(true);
    expect(updates.at(-1).consensus).toBe(true);

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('4.3 Jedna żywa mafia — jeden wybór = konsensus', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupAtNightMafia(ctx.url);
    const rp = ctx.pb._store.room_players.find((p) => p.room_id === roomId && p.user_id === 'p03');
    await ctx.pb.collection('room_players').update(rp.id, { eliminated_at: new Date().toISOString() });

    const r = await submitNightAction(socketById.p04.socket, 'p05');
    expect(r.ok).toBe(true);
    expect(r.consensus).toBe(true);

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('4.4 Odmowa zabójstwa dla nie-mafii i mastera', async () => {
    const { masterSocket, sockets, socketById } = await setupAtNightMafia(ctx.url);
    expect((await submitNightAction(socketById.p05.socket, 'p03')).error).toBe('no_action');
    expect((await submitNightAction(socketById.p01.socket, 'p03')).error).toBe('wrong_phase');
    expect((await submitNightAction(masterSocket, 'p03')).error).toBe('master_cannot_act');

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('4.5 Cel wyeliminowany — odrzucenie; mafia może wskazać inną mafię', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupAtNightMafia(ctx.url);
    const dead = ctx.pb._store.room_players.find((p) => p.room_id === roomId && p.user_id === 'p05');
    await ctx.pb.collection('room_players').update(dead.id, { eliminated_at: new Date().toISOString() });

    expect((await submitNightAction(socketById.p03.socket, 'p05')).error).toBe('target_eliminated');

    const r = await submitNightAction(socketById.p03.socket, 'p04');
    expect(r.ok).toBe(true);

    teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });
});
