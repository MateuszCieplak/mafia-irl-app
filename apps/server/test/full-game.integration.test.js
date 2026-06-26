import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import { setupLobbyStartedWithPhaseDetective, clearAssignRolesForTest } from './helpers/setupGame.js';
import { advancePhase, submitNightAction, submitVote, emitAck } from './helpers/factory.js';

/**
 * Scenariusz zbliżony do specyfikacji: R1 blokada zabójstwa, eliminacja przez głos,
 * R2 zabójstwo lekarza i wyrzucenie mafii, R3 pojedyncza mafia zabija obywatela,
 * R4 głosowanie wygrywa miasto.
 */
describe('10. Integracja pełnej gry', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('pełny przebieg — kolejność zdarzeń, DB, historia detektywa, game_over miasto', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);
    const log = [];
    masterSocket.on('night_resolved', (p) => log.push(['night_resolved', p]));
    masterSocket.on('vote_resolved', (p) => log.push(['vote_resolved', p]));
    masterSocket.on('game_over', (p) => log.push(['game_over', p]));

    // Runda 1 noc: det p03, lekarz p05, mafia p05 — blokada
    await submitNightAction(socketById.p01.socket, 'p03');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p02.socket, 'p05');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p03.socket, 'p05');
    await submitNightAction(socketById.p04.socket, 'p05');
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    // Dzień 1: 6× głos na p07, 4× skip (10 graczy)
    await advancePhase(masterSocket);
    for (const id of ['p01', 'p02', 'p03', 'p04', 'p05', 'p06']) {
      await submitVote(socketById[id].socket, 'p07');
    }
    for (const id of ['p07', 'p08', 'p09', 'p10']) {
      await submitVote(socketById[id].socket, null);
    }
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    expect(ctx.pb._store.room_players.find((p) => p.user_id === 'p07' && p.room_id === roomId).eliminated_at).toBeTruthy();

    // Runda 2 noc: det p04, lekarz p01, mafia zabija p02
    await submitNightAction(socketById.p01.socket, 'p04');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p02.socket, 'p01');
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p03.socket, 'p02');
    await submitNightAction(socketById.p04.socket, 'p02');
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    // Dzień 2: 5× p03, 3× p08, reszta skip — 9 żywych (bez p07)
    await advancePhase(masterSocket);
    for (const id of ['p01', 'p04', 'p05', 'p06', 'p08']) {
      await submitVote(socketById[id].socket, 'p03');
    }
    await submitVote(socketById.p09.socket, 'p08');
    await submitVote(socketById.p10.socket, 'p08');
    await submitVote(socketById.p03.socket, null);
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    expect(ctx.pb._store.room_players.find((p) => p.user_id === 'p03' && p.room_id === roomId).eliminated_at).toBeTruthy();

    // Runda 3 noc: det p09, brak lekarza — tylko mafia p04, zabójstwo p06
    await submitNightAction(socketById.p01.socket, 'p09');
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);
    await submitNightAction(socketById.p04.socket, 'p06');
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    // Dzień 3: wszyscy żywi na p04 (7 głosów wystarczy przy remisie — większość na p04)
    await advancePhase(masterSocket);
    const aliveIds = ['p01', 'p04', 'p05', 'p08', 'p09', 'p10'].filter((id) => {
      const rp = ctx.pb._store.room_players.find((p) => p.user_id === id && p.room_id === roomId);
      return rp && !rp.eliminated_at;
    });
    for (const id of aliveIds) {
      await submitVote(socketById[id].socket, 'p04');
    }
    await advancePhase(masterSocket);
    await advancePhase(masterSocket);

    const over = log.find(([e]) => e === 'game_over');
    expect(over).toBeDefined();
    expect(over[1].winner).toBe('town');
    expect(over[1].roles).toMatchObject({
      p01: 'detective',
      p04: 'mafia',
    });

    const hist = await emitAck(socketById.p01.socket, 'get_game_state');
    expect(hist.your_action_history.detective.length).toBeGreaterThanOrEqual(3);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });
});
