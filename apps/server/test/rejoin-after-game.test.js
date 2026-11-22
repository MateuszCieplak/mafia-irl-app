import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import {
  createRoom,
  joinPlayers,
  makePlayers,
  connectTestClient,
  emitAck,
  startGame,
  advancePhase,
  submitNightAction,
} from './helpers/factory.js';
import { setAssignRolesForTest, clearAssignRolesForTest } from '../game/roles.js';
import { buildGameSummary, townWinProbability, townOdds } from '../game/summary.js';
import { rooms } from '../game/state.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('12. Powrót do pokoju po grze / ponowne połączenie', () => {
  let ctx;
  const open = [];

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    for (const s of open.splice(0)) s.disconnect();
    clearAssignRolesForTest();
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('12.1 Rozłączenie starego socketu nie wyrzuca gracza, który wrócił nowym socketem (lobby)', async () => {
    const { roomId, code, masterSocket } = await createRoom(ctx.url, { lobby_disconnect_grace_ms: 60 });
    open.push(masterSocket);
    const [p1] = await joinPlayers(ctx.url, code, makePlayers(1));

    // Telefon po wybudzeniu: nowy socket dołącza, zanim stary zostanie rozłączony.
    const fresh = await connectTestClient(ctx.url, p1.user);
    open.push(fresh);
    expect((await emitAck(fresh, 'join_room', { code })).ok).toBe(true);

    p1.socket.disconnect();
    await wait(150); // dłużej niż karencja

    const state = rooms.get(roomId);
    expect(state.players.has(p1.user.id)).toBe(true);
    expect(state.players.get(p1.user.id).socketId).toBe(fresh.id);
    const inDb = ctx.pb._store.room_players.filter((p) => p.room_id === roomId && p.user_id === p1.user.id);
    expect(inDb).toHaveLength(1);

    // Obecność (lista online) też należy do nowego socketu.
    const online = await emitAck(masterSocket, 'get_online_users');
    expect(online.users.some((u) => u.id === p1.user.id)).toBe(true);
  });

  it('12.2 Pełny cykl: koniec gry → wróć do pokoju → gracze widzą lobby; gracz offline wylatuje po karencji', async () => {
    setAssignRolesForTest((ids) =>
      Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 'mafia' : 'citizen'])),
    );
    const { roomId, code, masterSocket } = await createRoom(ctx.url, { lobby_disconnect_grace_ms: 60 });
    open.push(masterSocket);
    const players = await joinPlayers(ctx.url, code, makePlayers(4));
    players.forEach((p) => open.push(p.socket));

    expect((await startGame(masterSocket)).ok).toBe(true);
    // Gracz p04 zamyka aplikację w trakcie gry.
    players[3].socket.disconnect();
    await wait(30);

    expect((await emitAck(masterSocket, 'end_game')).ok).toBe(true);

    const resets = [];
    players[0].socket.on('room_reset_to_lobby', (d) => resets.push(d));
    expect((await emitAck(masterSocket, 'return_to_room')).ok).toBe(true);
    await wait(20);
    expect(resets).toHaveLength(1);

    // Gracz online dołącza ponownie — pokój jest w lobby.
    const rejoin = await emitAck(players[1].socket, 'join_room', { code });
    expect(rejoin.ok).toBe(true);
    const st = await emitAck(players[1].socket, 'get_game_state');
    expect(st.status).toBe('lobby');

    // Offline p04 znika z pokoju po karencji (nie blokuje startu kolejnej gry).
    await wait(150);
    expect(rooms.get(roomId).players.has(players[3].user.id)).toBe(false);

    // Kolejna gra startuje bez „player_offline”.
    expect((await startGame(masterSocket)).ok).toBe(true);
  });

  it('12.3 get_my_active_room zwraca pokój gracza (po ponownym otwarciu aplikacji)', async () => {
    const { code, masterSocket } = await createRoom(ctx.url);
    open.push(masterSocket);
    const [p1] = await joinPlayers(ctx.url, code, makePlayers(1));
    p1.socket.disconnect();

    // „Nowe uruchomienie Chrome” — nowy socket, jeszcze bez join_room.
    const fresh = await connectTestClient(ctx.url, p1.user);
    open.push(fresh);
    const res = await emitAck(fresh, 'get_my_active_room');
    expect(res.ok).toBe(true);
    expect(res.room).toMatchObject({ code, status: 'lobby', isMaster: false });

    // Wyjście z banera: gracz znika z lobby.
    expect((await emitAck(fresh, 'leave_room', { code })).ok).toBe(true);
    const after = await emitAck(fresh, 'get_my_active_room');
    expect(after.room).toBeNull();
  });

  it('12.4 game_over niesie podsumowanie z przebiegiem rund i szansami', async () => {
    setAssignRolesForTest((ids) =>
      Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 'mafia' : i === 1 ? 'detective' : 'citizen'])),
    );
    const { code, masterSocket } = await createRoom(ctx.url);
    open.push(masterSocket);
    const players = await joinPlayers(ctx.url, code, makePlayers(4));
    players.forEach((p) => open.push(p.socket));
    const [mafia, det, c1] = players;

    let over = null;
    c1.socket.on('game_over', (d) => (over = d));

    await startGame(masterSocket);
    await advancePhase(masterSocket); // night_detective
    await submitNightAction(det.socket, mafia.user.id);
    await advancePhase(masterSocket); // night_doctor
    await advancePhase(masterSocket); // night_mafia
    await submitNightAction(mafia.socket, c1.user.id);
    await advancePhase(masterSocket); // night_resolve → c1 ginie
    await advancePhase(masterSocket); // day_deliberation
    await advancePhase(masterSocket); // day_vote
    for (const p of [mafia, det, players[3]]) {
      await emitAck(p.socket, 'vote', { targetId: mafia.user.id });
    }
    await advancePhase(masterSocket); // day_resolve → mafia wyrzucona → miasto wygrywa
    await wait(30);

    expect(over?.winner).toBe('town');
    const s = over.summary;
    expect(s.rounds).toHaveLength(1);
    expect(s.rounds[0].night.detective[0]).toMatchObject({ targetId: mafia.user.id, isMafia: true });
    expect(s.rounds[0].night.result.eliminatedId).toBe(c1.user.id);
    expect(s.rounds[0].day.result).toMatchObject({ eliminatedId: mafia.user.id, eliminatedRole: 'mafia' });
    expect(s.odds.map((o) => o.label)).toEqual(['Start', 'Noc 1', 'Dzień 1']);
    expect(s.odds.at(-1).townPct).toBe(100);
    expect(s.stats).toMatchObject({ mafiaKills: 1, detectiveHits: 1, mafiaLynched: 1 });

    // Po odświeżeniu strony podsumowanie przychodzi z get_game_state.
    const st = await emitAck(c1.socket, 'get_game_state');
    expect(st.summary?.winner).toBe('town');
  });

  it('12.5 Model szans: brzegi i monotoniczność', () => {
    expect(townWinProbability(0, 3, 'night')).toBe(1);
    expect(townWinProbability(2, 2, 'day')).toBe(0);
    const a = townWinProbability(1, 6, 'night');
    const b = townWinProbability(2, 6, 'night');
    expect(a).toBeGreaterThan(b);
    // Układ sił: więcej żywych obywateli = lepiej dla miasta, więcej mafii = gorzej.
    for (let m = 1; m <= 3; m++) {
      for (let t = m + 1; t <= 9; t++) {
        expect(townOdds(m, t + 1)).toBeGreaterThanOrEqual(townOdds(m, t));
        if (m > 1) expect(townOdds(m - 1, t)).toBeGreaterThanOrEqual(townOdds(m, t));
      }
    }
    expect(buildGameSummary({ roles: {}, players: new Map(), insightLog: [] }, null).odds).toHaveLength(1);
  });
});
