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

// Role w testach: p01/p02 — detektyw i lekarz, p03/p04 — mafia, p05–p10 — zwykli obywatele.
const MAFIA = ['p03', 'p04'];
const TOWN = ['p01', 'p02', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10'];

const ADVANCED = {
  advanced_mode: true,
  card_min_round: 1, // zgłoszenie możliwe już w głosowaniu rundy 1 (efekt w nocy 2)
  card_assignment: 'manual',
  card_citizen_manual: ['check', 'shield'],
  card_mafia_manual: ['mafia_shield', 'alibi'],
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

  /** Gracz z kartą indywidualną danego typu (check / alibi / false_lead). */
  function holderOf(held, type) {
    return Object.keys(held).find((id) => held[id].some((c) => c.type === type && c.scope === 'individual'));
  }

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

  /** Czeka na zdarzenie socketu (prywatny wynik tarczy). */
  function nextEvent(socket, name) {
    return new Promise((resolve) => socket.once(name, resolve));
  }

  it('12.1 Ręczne rozdanie: Sprawdzenie ma jeden obywatel, Alibi jeden mafioso, tarcze są wspólne dla drużyny', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const held = await holders(game.sockets);

    const checkId = holderOf(held, 'check');
    const alibiId = holderOf(held, 'alibi');
    expect(TOWN).toContain(checkId);
    expect(MAFIA).toContain(alibiId);
    expect(Object.keys(held).filter((id) => held[id].some((c) => c.type === 'check'))).toHaveLength(1);
    expect(Object.keys(held).filter((id) => held[id].some((c) => c.type === 'alibi'))).toHaveLength(1);

    // Tarcza obywateli widoczna dla każdego nie-mafiosa, Tarcza mafii dla każdego mafiosa.
    // Tarcza obywateli ma dokładnie jeden obywatel (nie cała drużyna).
    const shieldHolders = Object.keys(held).filter((id) => held[id].some((c) => c.type === 'shield'));
    expect(shieldHolders).toHaveLength(1);
    expect(TOWN).toContain(shieldHolders[0]);
    expect(held[shieldHolders[0]].find((c) => c.type === 'shield').scope).toBe('individual');
    for (const id of MAFIA) {
      expect(held[id].some((c) => c.type === 'mafia_shield' && c.scope === 'global')).toBe(true);
      expect(held[id].some((c) => c.type === 'shield')).toBe(false);
    }
    // Maksymalnie 2 karty na drużynę, rozłożone na różnych graczy.
    expect(held[checkId]).toHaveLength(1);
    expect(shieldHolders[0]).not.toBe(checkId);

    teardown(game.masterSocket, game.sockets);
  });

  it('12.1b Losowanie: liczba kart i pula z ustawień, nigdy więcej niż 2 na drużynę', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, {
      advanced_mode: true,
      card_assignment: 'random',
      card_citizen_count: 0,
      card_mafia_count: 2,
      card_mafia_pool: ['jam', 'mafia_shield', 'alibi'],
      min_players: 10,
    });
    const held = await holders(game.sockets);
    // Obywatele: 0 kart.
    for (const id of TOWN) expect(held[id]).toEqual([]);
    // Mafia: dwie różne karty z puli (indywidualna Alibi liczy się tylko u jednego mafiosa).
    const types = new Set();
    for (const id of MAFIA) for (const c of held[id]) types.add(c.type);
    const mafiaTypes = [...types];
    expect(mafiaTypes.every((t) => ['jam', 'mafia_shield', 'alibi'].includes(t))).toBe(true);
    expect(mafiaTypes.length).toBe(2);

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

  it('12.3 Karty nocne tylko w głosowaniu i od progu rundy; tarcza działa od początku', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, {
      ...ADVANCED,
      card_min_round: 3,
    });
    const held = await holders(game.sockets);
    const checkId = holderOf(held, 'check');

    // Poza głosowaniem — odrzucone.
    expect((await declare(game.socketById[checkId].socket, 'check')).error).toBe('wrong_phase');

    await reachDayVote(game);
    // Runda 1 < próg 3.
    const early = await declare(game.socketById[checkId].socket, 'check');
    expect(early.ok).toBe(false);
    expect(early.error).toBe('too_early');
    expect(early.availableFromRound).toBe(3);
    // Alibi też podlega progowi.
    const alibiId = holderOf(held, 'alibi');
    expect((await declare(game.socketById[alibiId].socket, 'alibi')).error).toBe('too_early');
    // Tarcza — bez progu.
    const shieldId = holderOf(held, 'shield');
    expect((await declare(game.socketById[shieldId].socket, 'shield')).ok).toBe(true);

    teardown(game.masterSocket, game.sockets);
  });

  it('12.4 Kolejność nocy: karta mafii → karta obywatela; Alibi ukrywa mafiozę przed Sprawdzeniem', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const held = await holders(game.sockets);
    const checkId = holderOf(held, 'check');
    const alibiId = holderOf(held, 'alibi');
    const otherMafia = MAFIA.find((id) => id !== alibiId);

    await reachDayVote(game);
    const phasesSeen = [];
    game.masterSocket.on('phase_changed', (p) => phasesSeen.push(p.phase));

    expect((await declare(game.socketById[checkId].socket, 'check')).ok).toBe(true);
    // Tej samej karty nie można zgłosić dwa razy.
    expect((await declare(game.socketById[checkId].socket, 'check')).error).toBe('already_queued');
    // Obywatel nie zgłosi karty mafii; mafia — karty obywatela.
    expect((await declare(game.socketById[checkId].socket, 'alibi')).error).toBe('no_card');
    expect((await declare(game.socketById[alibiId].socket, 'check')).error).toBe('no_card');
    // Alibi jest indywidualne — drugi mafioso jej nie ma.
    expect((await declare(game.socketById[otherMafia].socket, 'alibi')).error).toBe('no_card');
    expect((await declare(game.socketById[alibiId].socket, 'alibi')).ok).toBe(true);

    const first = await skipVotesAndStartRound2(game);
    expect(first.phase).toBe('night_mafia_card');

    // Kartę aktywuje tylko jej właściciel.
    const owner = await getGameState(game.socketById[alibiId].socket);
    expect(owner.cardPrompt.type).toBe('alibi');
    expect([...owner.cardPrompt.candidates].sort()).toEqual(['p03', 'p04']);
    expect((await getGameState(game.socketById[otherMafia].socket)).cardPrompt).toBeNull();
    expect(
      (await emitAck(game.socketById[otherMafia].socket, 'card_night_action', { targetId: 'p03' })).error,
    ).toBe('not_your_turn');
    expect(
      (await emitAck(game.socketById[alibiId].socket, 'card_night_action', { targetId: 'p05' })).error,
    ).toBe('invalid_target'); // Alibi tylko na żywego mafiozę
    const alibi = await emitAck(game.socketById[alibiId].socket, 'card_night_action', { targetId: 'p03' });
    expect(alibi.ok).toBe(true);

    expect((await advancePhase(game.masterSocket)).phase).toBe('night_citizen_card');

    const me = await getGameState(game.socketById[checkId].socket);
    expect(me.cardPrompt).toMatchObject({ type: 'check', targetCount: 3 });
    expect(me.cardPrompt.candidates).not.toContain(checkId); // nie można sprawdzić siebie
    const bystander = TOWN.find((id) => id !== checkId);
    expect((await getGameState(game.socketById[bystander].socket)).cardPrompt).toBeNull();

    const others = TOWN.filter((id) => id !== checkId);
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
    // Prawdziwie jest 1 mafia (p03), ale Alibi (zagrane tej samej nocy, przed Sprawdzeniem) ją ukrywa.
    expect(res.result.count).toBe(0);

    // Wynik zostaje w dzienniku obywatela, nie u innych.
    const after = await getGameState(game.socketById[checkId].socket);
    expect(after.cardLog).toEqual([
      expect.objectContaining({ kind: 'check', targetIds: ['p03', others[0], others[1]], count: 0 }),
    ]);
    expect(after.cards.find((c) => c.type === 'check')).toMatchObject({ used: true });
    expect((await getGameState(game.socketById[bystander].socket)).cardLog).toEqual([]);

    // Alibi zużyte — kolejne sprawdzenie pokazałoby prawdę (efekt jednorazowy).
    expect((await getGameState(game.socketById.p03.socket)).mafiaCard.wards.alibi).toEqual([]);

    expect((await advancePhase(game.masterSocket)).phase).toBe('night_detective');
    expect(phasesSeen).toEqual(
      expect.arrayContaining(['day_resolve', 'night_mafia_card', 'night_citizen_card', 'night_detective']),
    );

    teardown(game.masterSocket, game.sockets);
  });

  it('12.4b Alibi nie działa na detektywa: detektyw widzi prawdziwą rolę', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const held = await holders(game.sockets);
    const alibiId = holderOf(held, 'alibi');

    await reachDayVote(game);
    expect((await declare(game.socketById[alibiId].socket, 'alibi')).ok).toBe(true);
    expect((await skipVotesAndStartRound2(game)).phase).toBe('night_mafia_card');
    await emitAck(game.socketById[alibiId].socket, 'card_night_action', { targetId: alibiId });
    expect((await advancePhase(game.masterSocket)).phase).toBe('night_detective');

    const res = await emitAck(game.socketById.p01.socket, 'night_action', { targetId: alibiId });
    expect(res.ok).toBe(true);
    expect(res.result.is_mafia).toBe(true);

    teardown(game.masterSocket, game.sockets);
  });

  it('12.5 Zakłócenie (karta wspólna mafii): Sprawdzenie pokazuje wynik inny niż prawdziwy', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, {
      ...ADVANCED,
      card_mafia_manual: ['jam'],
    });
    const held = await holders(game.sockets);
    const checkId = holderOf(held, 'check');

    await reachDayVote(game);
    await declare(game.socketById[checkId].socket, 'check');
    expect((await declare(game.socketById.p03.socket, 'jam')).ok).toBe(true);
    await skipVotesAndStartRound2(game);

    // Aktorem jest ten, kto zgłosił kartę.
    expect((await emitAck(game.socketById.p04.socket, 'card_night_action', {})).error).toBe('not_your_turn');
    expect((await emitAck(game.socketById.p03.socket, 'card_night_action', {})).ok).toBe(true);
    await advancePhase(game.masterSocket);

    const others = TOWN.filter((id) => id !== checkId);
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
      card_mafia_manual: ['false_lead'],
    });
    const held = await holders(game.sockets);
    const checkId = holderOf(held, 'check');
    const leadId = holderOf(held, 'false_lead');
    const others = TOWN.filter((id) => id !== checkId);

    await reachDayVote(game);
    await declare(game.socketById[checkId].socket, 'check');
    expect((await declare(game.socketById[leadId].socket, 'false_lead')).ok).toBe(true);
    await skipVotesAndStartRound2(game);

    // Fałszywy trop nie może wskazać mafii.
    expect(
      (await emitAck(game.socketById[leadId].socket, 'card_night_action', { targetId: 'p03' })).error,
    ).toBe('invalid_target');
    expect(
      (await emitAck(game.socketById[leadId].socket, 'card_night_action', { targetId: others[0] })).ok,
    ).toBe(true);
    await advancePhase(game.masterSocket);

    const res = await emitAck(game.socketById[checkId].socket, 'card_night_action', {
      targetIds: [others[0], others[1], others[2]],
    });
    expect(res.ok).toBe(true);
    expect(res.result.count).toBe(1); // trójka bez mafii, ale „fałszywy trop” = 1

    teardown(game.masterSocket, game.sockets);
  });

  it('12.7 Tarcza obywateli ratuje wyrzuconego OBYWATELA; użytkownik dostaje sygnał „obywatel”', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const shieldId = holderOf(await holders(game.sockets), 'shield');
    const bystanderId = TOWN.find((id) => id !== shieldId);
    await reachDayVote(game);
    const verdicts = [];
    game.masterSocket.on('vote_resolved', (v) => verdicts.push(v));

    const user = game.socketById[shieldId].socket;
    const privateResult = nextEvent(user, 'card_shield_result');
    // Tarcza ma jeden obywatel — pozostali obywatele i mafia jej nie mają.
    expect((await declare(game.socketById[bystanderId].socket, 'shield')).error).toBe('no_card');
    expect((await declare(user, 'shield')).ok).toBe(true);
    expect((await declare(user, 'shield')).error).toBe('card_used');
    // Mafia nie ma tarczy obywateli.
    expect((await declare(game.socketById.p03.socket, 'shield')).error).toBe('no_card');

    for (const { socket } of game.sockets) await submitVote(socket, 'p06');
    await advancePhase(game.masterSocket); // → day_resolve

    expect(verdicts).toHaveLength(1);
    // Publicznie: zwykły brak eliminacji, bez śladu karty.
    expect(verdicts[0]).toMatchObject({ outcome: 'no_elimination', eliminatedPlayerId: null });
    expect(JSON.stringify(verdicts[0])).not.toMatch(/shield/i);
    const st = await getGameState(game.socketById.p01.socket);
    expect(st.players.find((p) => p.id === 'p06').eliminated).toBe(false);

    // Prywatnie: tarcza zadziałała, uratowany to obywatel.
    expect(await privateResult).toMatchObject({ kind: 'shield', targetId: 'p06', saved: true, targetTeam: 'town' });
    const log = (await getGameState(user)).cardLog;
    expect(log).toEqual([expect.objectContaining({ kind: 'shield', saved: true, targetTeam: 'town' })]);
    // Inni obywatele nie dostają wyniku.
    expect((await getGameState(game.socketById[bystanderId].socket)).cardLog).toEqual([]);

    teardown(game.masterSocket, game.sockets);
  });

  it('12.7b Tarcza obywateli NIE chroni mafii: wyrzucony mafioso odpada, a użytkownik widzi „mafia”', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const shieldId = holderOf(await holders(game.sockets), 'shield');
    await reachDayVote(game);
    const verdicts = [];
    game.masterSocket.on('vote_resolved', (v) => verdicts.push(v));

    const user = game.socketById[shieldId].socket;
    const privateResult = nextEvent(user, 'card_shield_result');
    expect((await declare(user, 'shield')).ok).toBe(true);

    for (const { socket } of game.sockets) await submitVote(socket, 'p03');
    await advancePhase(game.masterSocket);

    expect(verdicts[0]).toMatchObject({ outcome: 'eliminated', eliminatedPlayerId: 'p03' });
    expect(await privateResult).toMatchObject({ saved: false, targetId: 'p03', targetTeam: 'mafia' });
    const st = await getGameState(game.socketById.p01.socket);
    expect(st.players.find((p) => p.id === 'p03').eliminated).toBe(true);

    teardown(game.masterSocket, game.sockets);
  });

  it('12.8 Tarcza mafii ratuje wyrzuconego MAFIOSA (wspólna dla drużyny, jednorazowa)', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    await reachDayVote(game);
    const verdicts = [];
    game.masterSocket.on('vote_resolved', (v) => verdicts.push(v));
    expect((await declare(game.socketById.p03.socket, 'mafia_shield')).ok).toBe(true);
    expect((await declare(game.socketById.p04.socket, 'mafia_shield')).error).toBe('card_used');
    for (const { socket } of game.sockets) await submitVote(socket, 'p04');
    await advancePhase(game.masterSocket);
    expect(verdicts[0]).toMatchObject({ outcome: 'no_elimination', eliminatedPlayerId: null });
    expect((await getGameState(game.masterSocket)).players.find((p) => p.id === 'p04').eliminated).toBe(false);
    expect((await getGameState(game.socketById.p03.socket)).mafiaCard.log).toEqual([
      expect.objectContaining({ type: 'mafia_shield', targetId: 'p04', saved: true }),
    ]);
    teardown(game.masterSocket, game.sockets);
  });

  it('12.8b Tarcza mafii NIE chroni obywatela: wyrzucony obywatel odpada', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    await reachDayVote(game);
    const verdicts = [];
    game.masterSocket.on('vote_resolved', (v) => verdicts.push(v));
    await declare(game.socketById.p03.socket, 'mafia_shield');
    for (const { socket } of game.sockets) await submitVote(socket, 'p09');
    await advancePhase(game.masterSocket);
    expect(verdicts[0]).toMatchObject({ outcome: 'eliminated', eliminatedPlayerId: 'p09' });
    teardown(game.masterSocket, game.sockets);
  });

  it('12.8c Zgłoszona tarcza przy remisie przepada po cichu', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    await reachDayVote(game);
    const verdicts = [];
    game.masterSocket.on('vote_resolved', (v) => verdicts.push(v));
    await declare(game.socketById.p03.socket, 'mafia_shield');
    for (const [i, { socket }] of game.sockets.entries()) {
      await submitVote(socket, i < 5 ? 'p09' : 'p10');
    }
    await advancePhase(game.masterSocket);
    expect(verdicts[0]).toMatchObject({ outcome: 'tie', eliminatedPlayerId: null });
    expect(verdicts[0].shieldedPlayerId).toBeUndefined();
    teardown(game.masterSocket, game.sockets);
  });

  it('12.9 Master widzi kolejkę kart; gracze nie dostają jej w stanie gry', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const held = await holders(game.sockets);
    const checkId = holderOf(held, 'check');

    await reachDayVote(game);
    await declare(game.socketById[checkId].socket, 'check');

    const master = await getGameState(game.masterSocket);
    expect(master.cardQueue).toEqual({ check: [checkId], mafia: [], shields: 0 });
    // Karty indywidualne: Sprawdzenie + Tarcza (obywatele) + Alibi (mafia); wspólna: Tarcza mafii.
    expect(master.cardsOverview.holders).toHaveLength(3);
    expect(master.cardsOverview.team).toHaveLength(1);
    const player = await getGameState(game.socketById.p01.socket);
    expect(player.cardQueue).toBeUndefined();
    expect(player.cardsOverview).toBeUndefined();

    teardown(game.masterSocket, game.sockets);
  });

  it('12.11 Odkrycie: obywatel wskazuje dowolnego żywego gracza i poznaje jego rolę', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, {
      ...ADVANCED,
      card_citizen_manual: ['reveal'],
    });
    const held = await holders(game.sockets);
    const revealId = holderOf(held, 'reveal');
    expect(TOWN).toContain(revealId);

    await reachDayVote(game);
    expect((await declare(game.socketById[revealId].socket, 'reveal')).ok).toBe(true);
    expect((await declare(game.socketById[revealId].socket, 'reveal')).error).toBe('already_queued');
    expect((await skipVotesAndStartRound2(game)).phase).toBe('night_citizen_card');

    const me = await getGameState(game.socketById[revealId].socket);
    expect(me.cardPrompt.type).toBe('reveal');
    expect(me.cardPrompt.candidates).not.toContain(revealId);
    expect(me.cardPrompt.candidates).toContain('p03');

    expect(
      (await emitAck(game.socketById[revealId].socket, 'card_night_action', { targetId: revealId })).error,
    ).toBe('invalid_target');
    const res = await emitAck(game.socketById[revealId].socket, 'card_night_action', { targetId: 'p03' });
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ kind: 'reveal', targetId: 'p03', role: 'mafia' });
    expect((await getGameState(game.socketById[revealId].socket)).cardLog).toEqual([
      expect.objectContaining({ kind: 'reveal', targetId: 'p03', role: 'mafia' }),
    ]);

    teardown(game.masterSocket, game.sockets);
  });

  it('12.10 Wyeliminowany posiadacz karty przekazuje ją żywemu obywatelowi (razem ze zgłoszeniem)', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    const held = await holders(game.sockets);
    const checkId = holderOf(held, 'check');

    await reachDayVote(game);
    expect((await declare(game.socketById[checkId].socket, 'check')).ok).toBe(true);

    // Wioska wyrzuca posiadacza karty, zanim ją wykorzysta.
    for (const { socket, user } of game.sockets) {
      await submitVote(socket, user.id === checkId ? 'p10' : checkId);
    }
    await advancePhase(game.masterSocket); // → day_resolve

    const alive = game.sockets.filter(({ user }) => user.id !== checkId);
    const afterHeld = {};
    for (const { socket, user } of alive) afterHeld[user.id] = (await getGameState(socket)).cards || [];
    const heirs = Object.keys(afterHeld).filter((id) => afterHeld[id].some((c) => c.type === 'check'));
    expect(heirs).toHaveLength(1);
    expect(TOWN).toContain(heirs[0]);
    expect(heirs[0]).not.toBe(checkId);
    expect(afterHeld[heirs[0]].find((c) => c.type === 'check')).toMatchObject({ used: false, queued: true });

    // Zgłoszenie przeszło razem z kartą — master widzi nowego właściciela, a on dostaje turę.
    expect((await getGameState(game.masterSocket)).cardQueue.check).toEqual([heirs[0]]);
    expect((await advancePhase(game.masterSocket)).phase).toBe('night_citizen_card');
    expect((await getGameState(game.socketById[heirs[0]].socket)).cardPrompt).toMatchObject({ type: 'check' });

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

  it('13.1 Bez zgłoszenia nie ma tur kart; zgłoszona tarcza nie dodaje tury nocnej', async () => {
    const game = await setupGameStartedBeforeFirstPhaseAdvance(ctx.url, ADVANCED);
    await advanceUntilPhase(game.masterSocket, 'day_vote');
    for (const { socket } of game.sockets) await submitVote(socket, null);
    await advancePhase(game.masterSocket);
    // Nikt nie zgłosił karty → noc zaczyna się zwykłym detektywem.
    expect((await advancePhase(game.masterSocket)).phase).toBe('night_detective');

    const st = await getGameState(game.sockets[0].socket);
    expect(st.nextPhase).toBe('night_doctor');

    // Dalej: dzień, głosowanie, zgłoszenie tarczy mafii (jawnie dla mastera).
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
