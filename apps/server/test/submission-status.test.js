import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import { setupLobbyStartedWithPhaseDetective, clearAssignRolesForTest } from './helpers/setupGame.js';
import {
  advancePhase,
  submitNightAction,
  submitVote,
  getGameState,
  playFullNightFromDetective,
  playDayDeliberationAndVoteResolve,
  allLivingPlayersSkipVote,
} from './helpers/factory.js';

/**
 * Telefon z wygaszonym ekranem gubi `phase_changed`, więc po wybudzeniu klient
 * odtwarza flagi „akcja/głos złożony” wyłącznie z get_game_state. Muszą dotyczyć
 * BIEŻĄCEJ nocy/rundy — inaczej gracz widzi „Akcja złożona” z poprzedniej nocy.
 */
describe('get_game_state — status złożonej akcji/głosu (wybudzenie telefonu)', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('flagi zerują się w nowej nocy dla wszystkich ról i ustawiają po akcji', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);
    const det = socketById.p01.socket;
    const doc = socketById.p02.socket;
    const mafia = socketById.p03.socket;
    const citizen = socketById.p05.socket;

    // Noc 1: każda rola po swojej akcji ma flagę ustawioną (zabicie obywatela p06).
    expect((await getGameState(det)).nightActionSubmitted).toBe(false);
    expect((await submitNightAction(det, 'p03')).ok).toBe(true);
    expect((await getGameState(det)).nightActionSubmitted).toBe(true);
    await advancePhase(masterSocket); // night_doctor
    expect((await getGameState(doc)).nightActionSubmitted).toBe(false);
    expect((await submitNightAction(doc, 'p05')).ok).toBe(true);
    expect((await getGameState(doc)).nightActionSubmitted).toBe(true);
    await advancePhase(masterSocket); // night_mafia
    expect((await submitNightAction(mafia, 'p06')).ok).toBe(true);
    expect((await submitNightAction(socketById.p04.socket, 'p06')).ok).toBe(true);
    expect((await getGameState(mafia)).nightActionSubmitted).toBe(true);
    await advancePhase(masterSocket); // night_resolve
    await advancePhase(masterSocket); // day_deliberation

    // Dzień 1: głos obywatela widoczny w stanie, potem nowa runda.
    const r = await playDayDeliberationAndVoteResolve(masterSocket, async () => {
      expect((await getGameState(citizen)).voteSubmitted).toBe(false);
      await allLivingPlayersSkipVote(sockets, ctx.pb, roomId);
      expect((await getGameState(citizen)).voteSubmitted).toBe(true);
    });
    expect(r.phase).toBe('night_detective');

    // Noc 2: nic jeszcze nie złożone — wcześniej klient trzymał flagę z nocy 1.
    for (const s of [det, doc, mafia]) {
      const st = await getGameState(s);
      expect(st.nightActionSubmitted).toBe(false);
      expect(st.voteSubmitted).toBe(false);
    }

    await advancePhase(masterSocket); // night_doctor
    await advancePhase(masterSocket); // night_mafia
    const st = await getGameState(mafia);
    expect(st.phase).toBe('night_mafia');
    expect(st.nightActionSubmitted).toBe(false);
    expect((await submitNightAction(mafia, 'p07')).ok).toBe(true);
    expect((await getGameState(mafia)).nightActionSubmitted).toBe(true);
    // Drugi mafioso jeszcze nie wybrał.
    expect((await getGameState(socketById.p04.socket)).nightActionSubmitted).toBe(false);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('mafia: różne cele → komunikat o braku zgody i ponowny wybór aż do konsensusu', async () => {
    const { masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);
    const mafiaA = socketById.p03.socket;
    const mafiaB = socketById.p04.socket;
    await advancePhase(masterSocket); // night_doctor
    await advancePhase(masterSocket); // night_mafia

    const updatesA = [];
    mafiaA.on('mafia_vote_update', (u) => updatesA.push(u));

    expect((await submitNightAction(mafiaA, 'p05')).ok).toBe(true);
    expect((await submitNightAction(mafiaB, 'p06')).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 30));

    // Mafia A dostaje informację o braku jednomyślności z głosami wspólników.
    const last = updatesA.at(-1);
    expect(last.waitingForConsensus).toBe(true);
    expect(last.votes).toEqual({ p03: 'p05', p04: 'p06' });

    // Po odświeżeniu: wybór odblokowany dla obu, flaga braku zgody widoczna.
    for (const s of [mafiaA, mafiaB]) {
      const st = await getGameState(s);
      expect(st.mafiaDisagreement).toBe(true);
      expect(st.nightActionSubmitted).toBe(false);
      expect(st.mafiaVotes).toEqual({ p03: 'p05', p04: 'p06' });
    }
    // Inne role nie dostają głosów mafii.
    expect((await getGameState(socketById.p05.socket)).mafiaVotes).toBeUndefined();

    // Ponowny wybór — B zmienia na cel A → konsensus.
    expect((await submitNightAction(mafiaB, 'p05')).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(updatesA.at(-1)).toMatchObject({ consensus: true, waitingForConsensus: false });
    const st = await getGameState(mafiaA);
    expect(st.mafiaDisagreement).toBe(false);
    expect(st.nightActionSubmitted).toBe(true);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });

  it('głos zeruje się w kolejnym dniu', async () => {
    const { roomId, masterSocket, sockets, socketById } = await setupLobbyStartedWithPhaseDetective(ctx.url);
    await playFullNightFromDetective(masterSocket, socketById, { kill: 'p06' });
    await playDayDeliberationAndVoteResolve(masterSocket, () => allLivingPlayersSkipVote(sockets, ctx.pb, roomId));
    await playFullNightFromDetective(masterSocket, socketById, { kill: 'p07' });
    await advancePhase(masterSocket); // day_vote
    const st = await getGameState(socketById.p05.socket);
    expect(st.phase).toBe('day_vote');
    expect(st.voteSubmitted).toBe(false);
    expect((await submitVote(socketById.p05.socket, null)).ok).toBe(true);
    expect((await getGameState(socketById.p05.socket)).voteSubmitted).toBe(true);

    masterSocket.disconnect();
    for (const { socket } of sockets) socket.disconnect();
    clearAssignRolesForTest();
  });
});
