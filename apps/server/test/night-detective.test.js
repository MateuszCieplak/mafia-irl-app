import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import {
  setupLobbyStartedWithPhaseDetective,
  setupGameStartedBeforeFirstPhaseAdvance,
  clearAssignRolesForTest,
} from './helpers/setupGame.js';
import { advancePhase, submitNightAction, emitAck, advanceCycleToNextNightDetective } from './helpers/factory.js';
import { expectEventMeta } from './helpers/eventMeta.js';

describe('2. Noc — detektyw', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  async function teardown(masterSocket, sockets) {
    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
  }

  it('2.1 Tylko detektyw dostaje night_action_prompt; sprawdzenie gracza mafii → is_mafia: true', async () => {
    const { roomId, code, masterSocket, sockets, socketById } = await setupGameStartedBeforeFirstPhaseAdvance(
      ctx.url,
    );

    const prompts = {};
    for (const { socket, user } of sockets) {
      socket.on('night_action_prompt', (p) => {
        if (p.phase === 'night_detective') prompts[user.id] = p;
      });
    }

    await advancePhase(masterSocket);
    await new Promise((r) => setTimeout(r, 30));

    expect(Object.keys(prompts)).toEqual(['p01']);
    expectEventMeta(prompts.p01, roomId, code);
    expect(prompts.p01.role).toBe('detective');

    const rMafia = await submitNightAction(socketById.p01.socket, 'p03');
    expect(rMafia.ok).toBe(true);
    expect(rMafia.result.is_mafia).toBe(true);

    await teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('2.1b Obiektel i lekarz — is_mafia: false (kolejne noce)', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    await submitNightAction(socketById.p01.socket, 'p05');
    await advanceCycleToNextNightDetective(masterSocket);

    const rCit = await submitNightAction(socketById.p01.socket, 'p05');
    expect(rCit.ok).toBe(true);
    expect(rCit.result.is_mafia).toBe(false);

    await advanceCycleToNextNightDetective(masterSocket);

    const rDoc = await submitNightAction(socketById.p01.socket, 'p02');
    expect(rDoc.ok).toBe(true);
    expect(rDoc.result.is_mafia).toBe(false);

    await teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('2.1c Wynik śledztwa tylko w callback (brak broadcastu wyniku)', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    const payloads = [];
    for (const { socket } of sockets) {
      if (typeof socket.onAny === 'function') {
        socket.onAny((ev, payload) => {
          if (payload && typeof payload === 'object' && 'is_mafia' in payload) {
            payloads.push({ socket: socket.id, ev });
          }
        });
      }
    }

    await submitNightAction(socketById.p01.socket, 'p04');

    expect(payloads.length).toBe(0);

    await teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('2.2 Odmowa: obywatel, mafia, lekarz, master w fazie detektywa', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    expect((await submitNightAction(socketById.p05.socket, 'p03')).error).toBe('no_action');
    expect((await submitNightAction(socketById.p03.socket, 'p05')).error).toBe('wrong_phase');
    expect((await submitNightAction(socketById.p02.socket, 'p05')).error).toBe('wrong_phase');
    expect((await submitNightAction(masterSocket, 'p05')).error).toBe('master_cannot_act');

    await teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('2.3 Eliminowany cel i druga akcja w tej samej fazie', async () => {
    const { masterSocket, sockets, socketById, roomId } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    const rp = ctx.pb._store.room_players.find((p) => p.room_id === roomId && p.user_id === 'p05');
    await ctx.pb.collection('room_players').update(rp.id, { eliminated_at: new Date().toISOString() });

    const r1 = await submitNightAction(socketById.p01.socket, 'p05');
    expect(r1.ok).toBe(false);
    expect(r1.error).toBe('target_eliminated');

    const r2 = await submitNightAction(socketById.p01.socket, 'p06');
    expect(r2.ok).toBe(true);

    const r3 = await submitNightAction(socketById.p01.socket, 'p07');
    expect(r3.ok).toBe(false);
    expect(r3.error).toBe('already_acted');

    await teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });

  it('2.4 Historia detektywa w get_game_state po 3 rundach', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);

    await submitNightAction(socketById.p01.socket, 'p03');
    await advanceCycleToNextNightDetective(masterSocket);

    await submitNightAction(socketById.p01.socket, 'p05');
    await advanceCycleToNextNightDetective(masterSocket);

    await submitNightAction(socketById.p01.socket, 'p06');
    await advanceCycleToNextNightDetective(masterSocket);

    const st = await emitAck(socketById.p01.socket, 'get_game_state');
    expect(st.ok).toBe(true);
    expect(st.your_action_history.detective).toHaveLength(3);
    expect(st.your_action_history.detective[0].targetId).toBe('p03');
    expect(st.your_action_history.detective[0].result.is_mafia).toBe(true);
    expect(st.your_action_history.detective[1].targetId).toBe('p05');
    expect(st.your_action_history.detective[1].result.is_mafia).toBe(false);

    await teardown(masterSocket, sockets);
    clearAssignRolesForTest();
  });
});
