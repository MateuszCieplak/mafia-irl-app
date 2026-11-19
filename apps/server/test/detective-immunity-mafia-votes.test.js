import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import {
  setupLobbyStartedWithPhaseDetective,
  setupAtNightMafia,
  clearAssignRolesForTest,
} from './helpers/setupGame.js';
import {
  advancePhase,
  submitNightAction,
  emitAck,
  getGameState,
  playFullNightFromDetective,
  playDayDeliberationAndVoteResolve,
  allLivingPlayersSkipVote,
} from './helpers/factory.js';
import { rooms } from '../game/state.js';

function teardown(masterSocket, sockets) {
  masterSocket.disconnect();
  for (const { socket } of sockets) socket.disconnect();
  clearAssignRolesForTest();
}

const stripMeta = ({ timestamp, phaseDeadline, roomId, roomCode, ...rest }) => rest;
const tick = () => new Promise((r) => setTimeout(r, 30));
const theState = () => [...rooms.values()][0];

describe('Immunitet detektywa w 1. nocy', () => {
  let ctx;
  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });
  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  async function nightWithKill(settings, kill, doc = 'p05') {
    const c = await setupLobbyStartedWithPhaseDetective(ctx.url, settings);
    const insights = [];
    c.masterSocket.on('master_game_insight', (e) => insights.push(e));
    let resolved;
    c.masterSocket.once('night_resolved', (p) => {
      resolved = p;
    });
    const r = await playFullNightFromDetective(c.masterSocket, c.socketById, { det: 'p06', doc, kill });
    expect(r.ok).toBe(true);
    return { ...c, resolved, insights };
  }

  it('wlaczony, runda 1: detektyw nie ginie, master dostaje flage', async () => {
    const c = await nightWithKill({ detective_first_night_immunity: true }, 'p01');
    expect(c.resolved.eliminatedPlayerId).toBeNull();
    expect(c.resolved.survivedNight).toBe(true);
    const rp = ctx.pb._store.room_players.find((p) => p.user_id === 'p01' && p.room_id === c.roomId);
    expect(rp.eliminated_at).toBeFalsy();
    const res = c.insights.find((e) => e.kind === 'night_result');
    expect(res.detective_immunity_triggered).toBe(true);
    expect(res.protection_was_effective).toBe(false);
    teardown(c.masterSocket, c.sockets);
  });

  it('night_resolved identyczny jak przy ochronie lekarza', async () => {
    const a = await nightWithKill({ detective_first_night_immunity: true }, 'p01');
    const resA = a.resolved;
    teardown(a.masterSocket, a.sockets);
    await stopTestServer(ctx);
    resetInMemoryGameState();
    ctx = await startTestServer();
    const b = await nightWithKill({}, 'p05', 'p05');
    expect(Object.keys(resA).sort()).toEqual(Object.keys(b.resolved).sort());
    expect(stripMeta(resA)).toEqual(stripMeta(b.resolved));
    const res = b.insights.find((e) => e.kind === 'night_result');
    expect(res.detective_immunity_triggered).toBe(false);
    teardown(b.masterSocket, b.sockets);
  });

  it('wylaczony (domyslnie): detektyw ginie w rundzie 1', async () => {
    const c = await nightWithKill({}, 'p01');
    expect(c.resolved.eliminatedPlayerId).toBe('p01');
    teardown(c.masterSocket, c.sockets);
  });

  it('wlaczony, ale runda 2: detektyw ginie', async () => {
    const c = await nightWithKill({ detective_first_night_immunity: true }, 'p05');
    expect(c.resolved.eliminatedPlayerId).toBeNull();
    await playDayDeliberationAndVoteResolve(c.masterSocket, async () =>
      allLivingPlayersSkipVote(c.sockets, ctx.pb, c.roomId),
    );
    let night2;
    c.masterSocket.once('night_resolved', (p) => {
      night2 = p;
    });
    const r = await playFullNightFromDetective(c.masterSocket, c.socketById, {
      det: 'p07',
      doc: 'p03',
      kill: 'p01',
    });
    expect(r.ok).toBe(true);
    expect(night2.eliminatedPlayerId).toBe('p01');
    teardown(c.masterSocket, c.sockets);
  });

  it('ustawienie trafia do get_game_state', async () => {
    const c = await setupLobbyStartedWithPhaseDetective(ctx.url, { detective_first_night_immunity: true });
    const st = await getGameState(c.masterSocket);
    expect(st.settings.detective_first_night_immunity).toBe(true);
    teardown(c.masterSocket, c.sockets);
  });
});

describe('Mafia - glosy wspolnikow i cofanie glosu', () => {
  let ctx;
  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });
  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  const kills = () => ctx.pb._store.night_actions.filter((a) => a.action_type === 'kill');

  it('mafia_vote_update trafia do obu mafiosow po kazdym glosie', async () => {
    const c = await setupAtNightMafia(ctx.url);
    const upd = { p03: [], p04: [] };
    c.socketById.p03.socket.on('mafia_vote_update', (p) => upd.p03.push(p));
    c.socketById.p04.socket.on('mafia_vote_update', (p) => upd.p04.push(p));
    await submitNightAction(c.socketById.p03.socket, 'p05');
    await tick();
    expect(upd.p03.at(-1).votes).toEqual({ p03: 'p05' });
    expect(upd.p04.at(-1).votes).toEqual({ p03: 'p05' });
    expect(upd.p04.at(-1).consensus).toBe(false);
    expect(upd.p04.at(-1).waitingForConsensus).toBe(false);
    await submitNightAction(c.socketById.p04.socket, 'p06');
    await tick();
    expect(upd.p03.at(-1).waitingForConsensus).toBe(true);
    expect(upd.p03.at(-1).votes).toEqual({ p03: 'p05', p04: 'p06' });
    teardown(c.masterSocket, c.sockets);
  });

  it('zmiana glosu po konsensusie przelicza go i usuwa nightActions.mafia', async () => {
    const c = await setupAtNightMafia(ctx.url);
    await submitNightAction(c.socketById.p03.socket, 'p05');
    const r = await submitNightAction(c.socketById.p04.socket, 'p05');
    expect(r.consensus).toBe(true);
    const state = theState();
    expect(state.nightActions.mafia.targetId).toBe('p05');
    expect(kills()).toHaveLength(1);

    const r2 = await submitNightAction(c.socketById.p04.socket, 'p06');
    expect(r2.consensus).toBe(false);
    expect(state.nightActions.mafia).toBeUndefined();
    expect(state.mafiaWaitingForConsensus).toBe(true);
    expect(kills()).toHaveLength(0);

    const r3 = await submitNightAction(c.socketById.p03.socket, 'p06');
    expect(r3.consensus).toBe(true);
    expect(state.nightActions.mafia.targetId).toBe('p06');
    expect(kills()).toHaveLength(1);

    await submitNightAction(c.socketById.p03.socket, 'p07');
    await submitNightAction(c.socketById.p04.socket, 'p07');
    expect(kills()).toHaveLength(1);
    expect(state.nightActions.mafia.targetId).toBe('p07');
    teardown(c.masterSocket, c.sockets);
  });

  it('mafia_retract_vote: cofa glos, czysci konsensus, emituje update i submitted:false', async () => {
    const c = await setupAtNightMafia(ctx.url);
    const submitted = [];
    c.masterSocket.on('night_action_submitted', (p) => submitted.push(p));
    const insights = [];
    c.masterSocket.on('master_game_insight', (e) => insights.push(e));
    await submitNightAction(c.socketById.p03.socket, 'p05');
    await submitNightAction(c.socketById.p04.socket, 'p05');

    const upd = [];
    c.socketById.p03.socket.on('mafia_vote_update', (p) => upd.push(p));
    const res = await emitAck(c.socketById.p04.socket, 'mafia_retract_vote');
    expect(res).toEqual({ ok: true });
    await tick();

    const state = theState();
    expect(state.nightActions.mafia).toBeUndefined();
    expect(state.mafiaTargets.has('p04')).toBe(false);
    expect(state.mafiaWaitingForConsensus).toBe(false);
    expect(upd.at(-1).votes).toEqual({ p03: 'p05' });
    expect(upd.at(-1).consensus).toBe(false);
    const last = submitted.at(-1);
    expect(last.role).toBe('mafia');
    expect(last.submitted).toBe(false);
    expect(insights.at(-1).kind).toBe('night_mafia');

    const st4 = await getGameState(c.socketById.p04.socket);
    expect(st4.nightActionSubmitted).toBe(false);
    expect(st4.mafiaVotes).toEqual({ p03: 'p05' });
    expect(st4.mafiaDisagreement).toBe(false);

    expect(await emitAck(c.socketById.p04.socket, 'mafia_retract_vote')).toEqual({ ok: true });

    const again = await submitNightAction(c.socketById.p04.socket, 'p05');
    expect(again.consensus).toBe(true);
    teardown(c.masterSocket, c.sockets);
  });

  it('mafia_retract_vote: bledy not_mafia i wrong_phase', async () => {
    const c = await setupAtNightMafia(ctx.url);
    expect(await emitAck(c.socketById.p05.socket, 'mafia_retract_vote')).toEqual({
      ok: false,
      error: 'not_mafia',
    });
    await advancePhase(c.masterSocket);
    expect(await emitAck(c.socketById.p03.socket, 'mafia_retract_vote')).toEqual({
      ok: false,
      error: 'wrong_phase',
    });
    teardown(c.masterSocket, c.sockets);
  });
});
