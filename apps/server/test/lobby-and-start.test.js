import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  startTestServer,
  stopTestServer,
  resetInMemoryGameState,
} from './helpers/testEnv.js';
import {
  createRoom,
  joinPlayers,
  makePlayers,
  startGame,
  emitAck,
} from './helpers/factory.js';
import { setAssignRolesForTest, clearAssignRolesForTest } from '../game/roles.js';
import { expectEventMeta } from './helpers/eventMeta.js';

describe('1. Lobby i start gry', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('1.1 Master tworzy pokój — kod, status lobby, is_master', async () => {
    const { roomId, code, masterSocket } = await createRoom(ctx.url, { min_players: 4 });
    expect(code).toMatch(/^[A-Z0-9]{5}$/);

    const room = ctx.pb._store.rooms.find((r) => r.id === roomId);
    expect(room.status).toBe('lobby');

    const rp = ctx.pb._store.room_players.filter((p) => p.room_id === roomId);
    expect(rp).toHaveLength(1);
    expect(rp[0].is_master).toBe(true);
    expect(rp[0].user_id).toBe('m0');

    masterSocket.disconnect();
  });

  it('1.2 Dziesięciu graczy dołącza — lista, potwierdzenie, broadcast player_joined', async () => {
    const { roomId, code, masterSocket } = await createRoom(ctx.url, { min_players: 10 });
    const players = makePlayers(10);
    const joins = [];

    masterSocket.on('player_joined', (payload) => joins.push(payload));

    const sockets = await joinPlayers(ctx.url, code, players);
    expect(sockets).toHaveLength(10);

    const list = ctx.pb._store.room_players.filter((p) => p.room_id === roomId);
    expect(list).toHaveLength(11);

    expect(joins).toHaveLength(10);
    for (const j of joins) {
      expect(j.players.length).toBeGreaterThanOrEqual(2);
    }

    for (const { socket } of sockets) socket.disconnect();
    masterSocket.disconnect();
  });

  it('1.3 Start gry — tylko własna rola, rozkład 1 detektyw 1 lekarz 2 mafia 6 obywateli, brak wycieku', async () => {
    const { roomId, code, masterSocket } = await createRoom(ctx.url, { min_players: 10 });
    const sockets = await joinPlayers(ctx.url, code, makePlayers(10));

    let masterGameStarted = null;
    masterSocket.on('game_started', (p) => {
      masterGameStarted = p;
    });

    const received = {};
    for (const { socket, user } of sockets) {
      socket.on('game_started', (p) => {
        received[user.id] = p;
      });
    }

    const res = await startGame(masterSocket);
    expect(res.ok).toBe(true);

    // Master dostaje game_started z role:null i isMaster:true (żeby mógł się przekierować).
    await new Promise((r) => setTimeout(r, 50));
    expect(masterGameStarted).not.toBeNull();
    expect(masterGameStarted.role).toBeNull();
    expect(masterGameStarted.isMaster).toBe(true);

    const byRole = { detective: 0, doctor: 0, mafia: 0, citizen: 0 };
    for (const rp of ctx.pb._store.room_players) {
      if (rp.room_id !== roomId || rp.user_id === 'm0') continue;
      byRole[rp.role]++;
    }
    expect(byRole).toEqual({
      detective: 1,
      doctor: 1,
      mafia: 2,
      citizen: 6,
    });

    for (const { user } of sockets) {
      const ev = received[user.id];
      expect(ev).toBeDefined();
      expectEventMeta(ev, roomId, code);
      expect(ev.role).toBeTruthy();
      expect(ev).not.toHaveProperty('roles');
      expect(Object.keys(ev).filter((k) => k.includes('role') && k !== 'role').length).toBe(0);
    }

    for (const { socket } of sockets) socket.disconnect();
    masterSocket.disconnect();
  });

  it('1.3b get_game_state — pojedyncza rola, brak mapy ról', async () => {
    setAssignRolesForTest((ids) => {
      const o = ['detective', 'doctor', 'mafia', 'mafia', ...Array(6).fill('citizen')];
      return Object.fromEntries(ids.map((id, i) => [id, o[i]]));
    });

    const { code, masterSocket } = await createRoom(ctx.url, { min_players: 10 });
    const sockets = await joinPlayers(ctx.url, code, makePlayers(10));

    await startGame(masterSocket);

    for (const { socket } of sockets) {
      const st = await emitAck(socket, 'get_game_state');
      expect(st.ok).toBe(true);
      expect(st.role).toBeTruthy();
      expect(st).not.toHaveProperty('roles');
    }

    for (const { socket } of sockets) socket.disconnect();
    masterSocket.disconnect();
    clearAssignRolesForTest();
  });
});
