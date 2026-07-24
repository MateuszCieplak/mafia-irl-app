import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import { setupLobbyStartedWithPhaseDetective, clearAssignRolesForTest } from './helpers/setupGame.js';
import {
  playFullNightFromDetective,
  playDayDeliberationAndVoteResolve,
  allPlayersSkipVote,
  advancePhase,
  submitNightAction,
  submitVote,
  emitAck,
} from './helpers/factory.js';
import { expectEventMeta } from './helpers/eventMeta.js';

describe('5. Rozwiązanie nocy i blokady wyeliminowanych', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('5.1 Zabójstwo przechodzi; publiczny payload bez roli; master summary', async () => {
    const { roomId, code, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(
      ctx.url,
    );

    let publicNight;
    masterSocket.once('night_resolved', (p) => {
      publicNight = p;
    });
    let masterSummary;
    // night_master_summary → master_game_insight z kind: 'night_result'
    masterSocket.on('master_game_insight', (p) => {
      if (p.kind === 'night_result') masterSummary = p;
    });

    await playFullNightFromDetective(masterSocket, socketById, {
      det: 'p06',
      doc: 'p03',
      kill: 'p05',
    });

    expect(publicNight.eliminatedPlayerId).toBe('p05');
    expect(publicNight.survivedNight).toBe(false);
    expectEventMeta(publicNight, roomId, code);
    expect(publicNight).not.toHaveProperty('role');

    expect(masterSummary.eliminatedId).toBe('p05');
    expect(masterSummary.protectedName).toBeTruthy();
    expect(masterSummary.protection_was_effective).toBe(false);
    expectEventMeta(masterSummary, roomId, code);

    const st = await emitAck(socketById.p05.socket, 'get_game_state');
    expect(st.players.find((p) => p.id === 'p05').eliminated).toBe(true);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('5.2 Zabójstwo zablokowane — brak eliminacji; master summary effective', async () => {
    const { roomId, code, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(
      ctx.url,
    );

    let summary;
    // night_master_summary → master_game_insight z kind: 'night_result'
    masterSocket.on('master_game_insight', (p) => {
      if (p.kind === 'night_result') summary = p;
    });
    let pub;
    masterSocket.once('night_resolved', (p) => {
      pub = p;
    });

    await playFullNightFromDetective(masterSocket, socketById, {
      det: 'p07',
      doc: 'p03',
      kill: 'p03',
    });

    expect(pub.eliminatedPlayerId).toBeNull();
    expect(pub.survivedNight).toBe(true);
    expectEventMeta(pub, roomId, code);
    expect(summary.eliminatedId).toBeNull();
    expect(summary.protection_was_effective).toBe(true);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('5.3 Wyeliminowany — czat dzienny wyłączony; głos i akcja nocna odrzucone', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    await playFullNightFromDetective(masterSocket, socketById, {
      det: 'p08',
      doc: 'p02',
      kill: 'p05',
    });

    expect(
      (await emitAck(socketById.p05.socket, 'chat_message', { channel: 'day', body: 'x' })).error,
    ).toBe('channel_disabled');

    await advancePhase(masterSocket);
    expect((await submitVote(socketById.p05.socket, 'p06')).error).toBe('eliminated');

    await Promise.all(
      sockets
        .filter(({ user }) => user.id !== 'p05')
        .map(({ socket }) => submitVote(socket, null)),
    );
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    expect((await submitNightAction(socketById.p05.socket, 'p06')).error).toBe('eliminated');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('5.5 Podwójne kliknięcie mastera nie przeskakuje fazy rozstrzygnięcia', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    await submitNightAction(socketById.p01.socket, 'p06');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p02.socket, 'p03');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p03.socket, 'p05');
    await submitNightAction(socketById.p04.socket, 'p05');

    // Oba kliknięcia wychodzą z night_mafia — drugie to duplikat (podwójny tap),
    // więc gra musi zatrzymać się na night_resolve, a nie wpaść w dyskusję.
    const [first, second] = await Promise.all([
      emitAck(masterSocket, 'advance_phase', { from: 'night_mafia' }),
      emitAck(masterSocket, 'advance_phase', { from: 'night_mafia' }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const rejected = first.ok ? second : first;
    expect(['stale_phase', 'advance_in_progress']).toContain(rejected.error);

    const st = await emitAck(socketById.p06.socket, 'get_game_state');
    expect(st.phase).toBe('night_resolve');

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('5.4 Werdykt nocy jest w get_game_state przez całą fazę night_resolve', async () => {
    // Gracz z wygaszonym ekranem nie odbiera eventu `night_resolved` — ekran
    // werdyktu musi dać się odtworzyć ze stanu, dopóki trwa faza.
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    // Noc rozegrana ręcznie, bo helper przechodzi od razu do day_deliberation,
    // a nas interesuje właśnie postój w night_resolve.
    await submitNightAction(socketById.p01.socket, 'p06');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p02.socket, 'p03');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p03.socket, 'p05');
    await submitNightAction(socketById.p04.socket, 'p05');
    await advancePhase(masterSocket);

    const during = await emitAck(socketById.p06.socket, 'get_game_state');
    expect(during.phase).toBe('night_resolve');
    expect(during.phaseResult).toEqual({
      kind: 'night',
      eliminatedPlayerId: 'p05',
      survivedNight: false,
    });

    // Master ręcznie przechodzi do dyskusji — werdykt znika razem z fazą.
    await advancePhase(masterSocket);
    const after = await emitAck(socketById.p06.socket, 'get_game_state');
    expect(after.phase).toBe('day_deliberation');
    expect(after.phaseResult).toBeNull();

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });
});
