import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import { createRoom, joinPlayers, makePlayers, startGame, advancePhase, submitNightAction, emitAck } from './helpers/factory.js';
import { setAssignRolesForTest, clearAssignRolesForTest, assignRoles, roleLimits, findRoleLimitViolation } from '../game/roles.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);
const count = (map, role) => Object.values(map).filter((r) => r === role).length;

describe('limity i liczba lekarzy/detektywów', () => {
  it('domyślnie po jednym lekarzu i detektywu', () => {
    const map = assignRoles(ids(9), {}, {});
    expect(count(map, 'doctor')).toBe(1);
    expect(count(map, 'detective')).toBe(1);
  });
  it('ustawienia zwiększają liczbę lekarzy i detektywów', () => {
    const map = assignRoles(ids(10), {}, { doctor_count: 2, detective_count: 3 });
    expect(count(map, 'doctor')).toBe(2);
    expect(count(map, 'detective')).toBe(3);
  });
  it('roleLimits i przekroczenie limitu w ręcznych przypisaniach', () => {
    expect(roleLimits({}, 8)).toEqual({ mafia: 2, detective: 1, doctor: 1 });
    expect(findRoleLimitViolation(ids(8), { p0: 'mafia', p1: 'mafia' }, {})).toBeNull();
    expect(findRoleLimitViolation(ids(8), { p0: 'mafia', p1: 'mafia', p2: 'mafia' }, {})).toEqual({
      role: 'mafia',
      limit: 2,
    });
    expect(findRoleLimitViolation(ids(8), { p0: 'doctor', p1: 'doctor' }, { doctor_count: 2 })).toBeNull();
    expect(findRoleLimitViolation(ids(8), { p0: 'detective', p1: 'detective' }, {})).toEqual({
      role: 'detective',
      limit: 1,
    });
  });
});

describe('wielu lekarzy i detektywów — osobne tury', () => {
  let ctx;
  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });
  afterEach(async () => {
    await stopTestServer(ctx);
    clearAssignRolesForTest();
    resetInMemoryGameState();
  });

  async function setup() {
    // p01,p02 detektywi; p03,p04 lekarze; p05,p06 mafia; reszta obywatele.
    const order = ['detective', 'detective', 'doctor', 'doctor', 'mafia', 'mafia', ...Array(4).fill('citizen')];
    setAssignRolesForTest((list) => Object.fromEntries(list.map((id, i) => [id, order[i]])));
    const { code, masterSocket } = await createRoom(ctx.url, {
      min_players: 10,
      max_players: 15,
      doctor_can_self_protect: true,
      doctor_repeat_protect: false,
      self_vote: true,
    });
    const sockets = await joinPlayers(ctx.url, code, makePlayers(10));
    await startGame(masterSocket);
    const byId = Object.fromEntries(sockets.map((s) => [s.user.id, s.socket]));
    return { masterSocket, sockets, byId };
  }

  it('każdy detektyw gra we własnej turze, a faza zmienia się dopiero po ostatnim', async () => {
    const { masterSocket, sockets, byId } = await setup();
    const phases = [];
    masterSocket.on('phase_changed', (p) => phases.push([p.phase, p.turn, p.turnCount]));

    await advancePhase(masterSocket); // night_detective, tura 0
    await new Promise((r) => setTimeout(r, 30));

    const early = await submitNightAction(byId.p02, 'p07');
    expect(early.ok).toBe(false);
    expect(early.error).toBe('not_your_turn');

    expect((await submitNightAction(byId.p01, 'p05')).ok).toBe(true);
    await advancePhase(masterSocket); // tura 1 — drugi detektyw
    expect((await submitNightAction(byId.p01, 'p06')).error).toBe('not_your_turn');
    const second = await submitNightAction(byId.p02, 'p05');
    expect(second.ok).toBe(true);
    expect(second.result.is_mafia).toBe(true);
    await advancePhase(masterSocket); // night_doctor, tura 0

    expect(phases).toEqual([
      ['night_detective', 0, 2],
      ['night_detective', 1, 2],
      ['night_doctor', 0, 2],
    ]);
    for (const { socket } of sockets) socket.disconnect();
    masterSocket.disconnect();
  });

  it('ochrona któregokolwiek lekarza blokuje zabójstwo', async () => {
    const { masterSocket, sockets, byId } = await setup();
    await advancePhase(masterSocket); // detektyw 1
    await advancePhase(masterSocket); // detektyw 2
    await advancePhase(masterSocket); // lekarz 1
    expect((await submitNightAction(byId.p03, 'p08')).ok).toBe(true);
    await advancePhase(masterSocket); // lekarz 2
    expect((await submitNightAction(byId.p03, 'p09')).error).toBe('not_your_turn');
    expect((await submitNightAction(byId.p04, 'p07')).ok).toBe(true);
    await advancePhase(masterSocket); // mafia
    expect((await submitNightAction(byId.p05, 'p08')).ok).toBe(true);
    expect((await submitNightAction(byId.p06, 'p08')).ok).toBe(true);

    let resolved;
    masterSocket.once('night_resolved', (p) => {
      resolved = p;
    });
    await advancePhase(masterSocket); // rozstrzygnięcie
    await new Promise((r) => setTimeout(r, 30));
    expect(resolved.eliminatedPlayerId).toBeNull();
    expect(resolved.survivedNight).toBe(true);
    for (const { socket } of sockets) socket.disconnect();
    masterSocket.disconnect();
  });

  it('start gry odrzuca ręczne przypisania ponad limit', async () => {
    clearAssignRolesForTest();
    const { code, masterSocket } = await createRoom(ctx.url, { min_players: 4, max_players: 15 });
    const sockets = await joinPlayers(ctx.url, code, makePlayers(8));
    const overrides = { p01: 'mafia', p02: 'mafia', p03: 'mafia' };
    const res = await emitAck(masterSocket, 'start_game', { roleOverrides: overrides });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('role_limit_exceeded');
    for (const { socket } of sockets) socket.disconnect();
    masterSocket.disconnect();
  });
});
