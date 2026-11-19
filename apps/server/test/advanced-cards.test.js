import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import {
  setupGameStartedBeforeFirstPhaseAdvance,
  clearAssignRolesForTest,
} from './helpers/setupGame.js';
import {
  advancePhase,
  advanceUntilPhase,
  emitAck,
  getGameState,
  submitVote,
} from './helpers/factory.js';

const ADVANCED = {
  advanced_mode: true,
  card_min_round: 2,
  card_mafia_special: 'alibi',
  min_players: 10,
};

describe('12. Mafia zaawansowana — karty mocy', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  function teardown(masterSocket, sockets) {
    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  }

  async function holders(sockets) {
    const out = {};
    for (const { socket, user } of sockets) {
      const st = await getGameState(socket);
      out[user.id] = st.cards || [];
    }
    return out;
  }

  /** Runda 1 do głosowania (min_round 2 → w rundzie 1 nie ma jeszcze tur kart). */
  async function reachDayVote(ctxGame) {
    await advanceUntilPhase(ctxGame.masterSocket, 'day_vote');
  }

  async function declare(socket, type) {
    return emitAck(socket, 'card_declare', { type });
  }

  async function skipVotesAndStartRound2(ctxGame) {
    for (const { socket } of ctxGame.sockets) await submitVote(socket, null);
    await advancePhase(ctxGame.masterSocket); // day_vote → day_resolve
    return advancePhase(ctxGame.masterSocket); // → pierwsza faza rundy 2
  }

  it('12.1 Karty losowane razem z rolami: Sprawdzenie i Tarcza u obywateli, karty drużynowe u mafii', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const held = await holders(game.sockets);

    const checkHolders = Object.entries(held).filter(([, c]) => c.some((x) => x.type === 'check'));
    const shieldHolders = Object.entries(held).filter(([, c]) => c.some((x) => x.type === 'shield'));
    expect(checkHolders).toHaveLength(1);
    expect(shieldHolders).toHaveLength(1);
    // Karty tylko u zwykłych obywateli (p05–p10).
    for (const [id] of [...checkHolders, ...shieldHolders]) {
      expect(['p05', 'p06', 'p07', 'p08', 'p09', 'p10']).toContain(id);
    }
    // Detektyw / lekarz — bez kart; mafia widzi karty drużyny.
    expect(held.p01).toEqual([]);
    expect(held.p02).toEqual([]);
    expect(held.p03.map((c) => c.type).sort()).toEqual(['alibi', 'mafia_shield']);
    expect(held.p04.map((c) => c.type).sort()).toEqual(['alibi', 'mafia_shield']);

    teardown(game.masterSocket, game.sockets);
  });

  it('12.2 Bez trybu zaawansowanego karty nie istnieją, a faza kart się nie pojawia', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, { min_players: 10 });
    const held = await holders(game.sockets);
    expect(Object.values(held).every((c) => c.length === 0)).toBe(true);

    await reachDayVote(game);
    expect((await declare(game.socketById.p05.socket, 'check')).error).toBe('cards_disabled');

    teardown(game.masterSocket, game.sockets);
  });

  it('12.3 Zgłoszenie karty tylko w głosowaniu i nie przed minimalną rundą', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, {
      ...ADVANCED,
      card_min_round: 3,
    });
    const held = await holders(game.sockets);
    const checkId = Object.keys(held).find((id) => held[id].some((c) => c.type === 'check'));

    // Poza głosowaniem — odrzucone.
    expect((await declare(game.socketById[checkId].socket, 'check')).error).toBe('wrong_phase');

    await reachDayVote(game);
    // Runda 1 → karta zadziałałaby w nocy 2, a minimum to runda 3.
    const early = await declare(game.socketById[checkId].socket, 'check');
    expect(early.ok).toBe(false);
    expect(early.error).toBe('too_early');
    expect(early.availableFromRound).toBe(3);

    teardown(game.masterSocket, game.sockets);
  });

  it('12.4 Kolejność nocy: karta mafii → karta obywatela → detektyw; Alibi ukrywa mafiozę przed Sprawdzeniem', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const held = await holders(game.sockets);
    const checkId = Object.keys(held).find((id) => held[id].some((c) => c.type === 'check'));

    await reachDayVote(game);
    const phasesSeen = [];
    game.masterSocket.on('phase_changed', (p) => phasesSeen.push(p.phase));

    expect((await declare(game.socketById[checkId].socket, 'check')).ok).toBe(true);
    // Tej samej karty nie można zgłosić dwa razy.
    expect((await declare(game.socketById[checkId].socket, 'check')).error).toBe('already_queued');
    // Obywatel nie może zgłosić karty mafii; mafia — karty obywatela.
    expect((await declare(game.socketById[checkId].socket, 'alibi')).error).toBe('no_card');
    expect((await declare(game.socketById.p03.socket, 'check')).error).toBe('no_card');
    expect((await declare(game.socketById.p03.socket, 'alibi')).ok).toBe(true);

    const first = await skipVotesAndStartRound2(game);
    expect(first.phase).toBe('night_mafia_card');

    // Mafioso aktywuje Alibi na p03.
    const mafiaState = await getGameState(game.socketById.p04.socket);
    expect(mafiaState.cardPrompt.type).toBe('alibi');
    // Serwer podaje tylko dozwolone cele: Alibi — żywi mafiosi.
    expect([...mafiaState.cardPrompt.candidates].sort()).toEqual(['p03', 'p04']);
    expect(
      (await emitAck(game.socketById.p04.socket, 'card_night_action', { targetId: 'p05' })).error,
    ).toBe('invalid_target'); // Alibi tylko na żywego mafiozę
    const alibi = await emitAck(game.socketById.p04.socket, 'card_night_action', { targetId: 'p03' });
    expect(alibi.ok).toBe(true);

    expect((await advancePhase(game.masterSocket)).phase).toBe('night_citizen_card');

    const me = await getGameState(game.socketById[checkId].socket);
    expect(me.cardPrompt).toMatchObject({ type: 'check', targetCount: 3 });
    expect(me.cardPrompt.candidates).not.toContain(checkId); // nie można sprawdzić siebie
    // Gracze bez karty nie dostają promptu.
    expect((await getGameState(game.socketById.p01.socket)).cardPrompt).toBeNull();

    const others = ['p05', 'p06', 'p07', 'p08', 'p09', 'p10'].filter((id) => id !== checkId);
    const bad = await emitAck(game.socketById[checkId].socket, 'card_night_action', {
      targetIds: ['p03', others[0]],
    });
    expect(bad.error).toBe('invalid_targets');
    const self = await emitAck(game.socketById[checkId].socket, 'card_night_action', {
      targetIds: [checkId, 'p03', others[0]],
    });
    expect(self.error).toBe('invalid_targets');

    const res = await emitAck(game.socketById[checkId].socket, 'card_night_action', {
      targetIds: ['p03', others[0], others[1]],
    });
    expect(res.ok).toBe(true);
    // Prawdziwie jest 1 mafia (p03), ale Alibi ją ukrywa.
    expect(res.result.count).toBe(0);

    // Wynik zostaje w dzienniku obywatela, nie u innych.
    const after = await getGameState(game.socketById[checkId].socket);
    expect(after.cardLog).toEqual([
      expect.objectContaining({ kind: 'check', targetIds: ['p03', others[0], others[1]], count: 0 }),
    ]);
    expect(after.cards[0]).toMatchObject({ type: 'check', used: true });
    expect((await getGameState(game.socketById.p01.socket)).cardLog).toEqual([]);

    // Alibi zużyte — kolejne sprawdzenie pokazałoby prawdę (efekt jednorazowy).
    expect((await getGameState(game.socketById.p03.socket)).mafiaCard.wards.alibi).toEqual([]);

    expect((await advancePhase(game.masterSocket)).phase).toBe('night_detective');
    expect(phasesSeen).toEqual(
      expect.arrayContaining(['day_resolve', 'night_mafia_card', 'night_citizen_card', 'night_detective']),
    );

    teardown(game.masterSocket, game.sockets);
  });

  it('12.5 Zakłócenie: Sprawdzenie pokazuje wynik inny niż prawdziwy', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, {
      ...ADVANCED,
      card_mafia_special: 'jam',
    });
    const held = await holders(game.sockets);
    const checkId = Object.keys(held).find((id) => held[id].some((c) => c.type === 'check'));

    await reachDayVote(game);
    await declare(game.socketById[checkId].socket, 'check');
    expect((await declare(game.socketById.p03.socket, 'jam')).ok).toBe(true);
    await skipVotesAndStartRound2(game);

    expect(
      (await emitAck(game.socketById.p03.socket, 'card_night_action', {})).ok,
    ).toBe(true);
    await advancePhase(game.masterSocket);

    const others = ['p05', 'p06', 'p07', 'p08', 'p09', 'p10'].filter((id) => id !== checkId);
    const res = await emitAck(game.socketById[checkId].socket, 'card_night_action', {
      targetIds: ['p03', others[0], others[1]],
    });
    expect(res.ok).toBe(true);
    expect(res.result.count).not.toBe(1); // prawda to 1 mafia

    teardown(game.masterSocket, game.sockets);
  });

  it('12.6 Fałszywy trop: niewinny gracz liczy się jako mafia przy Sprawdzeniu', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, {
      ...ADVANCED,
      card_mafia_special: 'false_lead',
    });
    const held = await holders(game.sockets);
    const checkId = Object.keys(held).find((id) => held[id].some((c) => c.type === 'check'));
    const others = ['p05', 'p06', 'p07', 'p08', 'p09', 'p10'].filter((id) => id !== checkId);

    await reachDayVote(game);
    await declare(game.socketById[checkId].socket, 'check');
    await declare(game.socketById.p04.socket, 'false_lead');
    await skipVotesAndStartRound2(game);

    // Fałszywy trop nie może wskazać mafii.
    expect(
      (await emitAck(game.socketById.p04.socket, 'card_night_action', { targetId: 'p03' })).error,
    ).toBe('invalid_target');
    expect(
      (await emitAck(game.socketById.p04.socket, 'card_night_action', { targetId: others[0] })).ok,
    ).toBe(true);
    await advancePhase(game.masterSocket);

    const res = await emitAck(game.socketById[checkId].socket, 'card_night_action', {
      targetIds: [others[0], others[1], others[2]],
    });
    expect(res.ok).toBe(true);
    expect(res.result.count).toBe(1); // trójka bez mafii, ale „fałszywy trop” = 1

    teardown(game.masterSocket, game.sockets);
  });

  it('12.7 Tarcza obywatela (wersja B): wyrzucenie kogokolwiek zostaje unieważnione', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const held = await holders(game.sockets);
    const shieldId = Object.keys(held).find((id) => held[id].some((c) => c.type === 'shield'));

    await reachDayVote(game);
    const verdicts = [];
    game.masterSocket.on('vote_resolved', (v) => verdicts.push(v));

    expect((await declare(game.socketById[shieldId].socket, 'shield')).ok).toBe(true);
    expect((await declare(game.socketById[shieldId].socket, 'shield')).error).toBe('card_used');

    for (const { socket } of game.sockets) await submitVote(socket, 'p06');
    await advancePhase(game.masterSocket); // → day_resolve

    expect(verdicts).toHaveLength(1);
    // Publicznie: zwykły brak eliminacji, bez śladu karty.
    expect(verdicts[0]).toMatchObject({ outcome: 'no_elimination', eliminatedPlayerId: null });
    expect(JSON.stringify(verdicts[0])).not.toMatch(/shield/i);
    const st = await getGameState(game.socketById.p01.socket);
    expect(st.players.find((p) => p.id === 'p06').eliminated).toBe(false);

    teardown(game.masterSocket, game.sockets);
  });

  it('12.8 Tarcza mafii działa tak samo, a niewykorzystana tarcza nie zdradza się przy remisie', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    await reachDayVote(game);
    const verdicts = [];
    game.masterSocket.on('vote_resolved', (v) => verdicts.push(v));

    expect((await declare(game.socketById.p03.socket, 'mafia_shield')).ok).toBe(true);
    expect((await declare(game.socketById.p04.socket, 'mafia_shield')).error).toBe('card_used');

    // Remis 5:5 — tarcza „przepada”, a wynik nie ujawnia karty.
    const ids = game.sockets.map((s) => s.user.id);
    for (const [i, { socket }] of game.sockets.entries()) {
      await submitVote(socket, i < 5 ? 'p09' : 'p10');
    }
    await advancePhase(game.masterSocket);
    expect(ids).toHaveLength(10);
    expect(verdicts[0]).toMatchObject({ outcome: 'tie', eliminatedPlayerId: null });
    expect(verdicts[0].shieldedPlayerId).toBeUndefined();

    teardown(game.masterSocket, game.sockets);
  });

  it('12.9 Master widzi kolejkę kart; gracze nie dostają jej w stanie gry', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const held = await holders(game.sockets);
    const checkId = Object.keys(held).find((id) => held[id].some((c) => c.type === 'check'));

    await reachDayVote(game);
    await declare(game.socketById[checkId].socket, 'check');

    const master = await getGameState(game.masterSocket);
    expect(master.cardQueue).toEqual({ check: [checkId], mafia: null, shields: 0 });
    expect(master.cardsOverview.holders).toHaveLength(2);
    const player = await getGameState(game.socketById.p01.socket);
    expect(player.cardQueue).toBeUndefined();
    expect(player.cardsOverview).toBeUndefined();

    teardown(game.masterSocket, game.sockets);
  });
});

describe('13. Tury kart tylko po zgłoszeniu', () => {
  let ctx;
  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });
  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('13.1 Bez zgłoszenia nie ma tur kart; zgłoszenie dodaje je tylko na jedną noc', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    await advanceUntilPhase(game.masterSocket, 'day_vote');
    for (const { socket } of game.sockets) await submitVote(socket, null);
    await advancePhase(game.masterSocket);
    // Nikt nie zgłosił karty → noc zaczyna się zwykłym detektywem.
    expect((await advancePhase(game.masterSocket)).phase).toBe('night_detective');

    const st = await getGameState(game.sockets[0].socket);
    expect(st.nextPhase).toBe('night_doctor');

    // Dalej: dzień, głosowanie, zgłoszenie karty mafii (tarcza zgłoszona jawnie dla mastera).
    await advanceUntilPhase(game.masterSocket, 'day_vote');
    expect((await declare(game.socketById.p03.socket, 'mafia_shield')).ok).toBe(true);
    expect((await getGameState(game.masterSocket)).cardQueue.shields).toBe(1);
    for (const { socket } of game.sockets) await submitVote(socket, null);
    await advancePhase(game.masterSocket);
    expect((await advancePhase(game.masterSocket)).phase).toBe('night_detective'); // tarcza nie ma tury nocnej

    for (const { socket } of game.sockets) socket.disconnect();
    game.masterSocket.disconnect();
    clearAssignRolesForTest();
  });
});

async function declare(socket, type) {
  return emitAck(socket, 'card_declare', { type });
}
