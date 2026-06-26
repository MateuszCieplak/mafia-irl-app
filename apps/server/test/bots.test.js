import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, resetInMemoryGameState } from './helpers/testEnv.js';
import {
  createRoom,
  joinPlayers,
  makePlayers,
  startGame,
  advancePhase,
  emitAck,
} from './helpers/factory.js';
import { rooms } from '../game/state.js';

/**
 * Czeka aż predykat zwróci true (poll co 10ms, timeout 2s). Wykorzystywane do
 * synchronizacji z asynchronicznymi akcjami botów (setTimeout w bots.js).
 */
async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 10, label = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timeout${label ? ` (${label})` : ''}`);
}

/**
 * Liczba żywych graczy (bez hosta) korzystając ze state in-memory.
 * Boty żyją tylko w state, prawdziwi gracze mają też zapis w PB.
 */
function aliveVoterCount(roomId) {
  const state = rooms.get(roomId);
  if (!state) return 0;
  let count = 0;
  for (const [id, info] of state.players.entries()) {
    if (id === state.hostId) continue;
    if (info.isBot) {
      if (!state.eliminatedBots?.has(id)) count++;
    }
    // Prawdziwi gracze: w pełno-botowym teście ich nie ma; można by sprawdzić PB,
    // ale tu używamy state.votes.size jako wyznacznik "wszyscy zagłosowali".
  }
  return count;
}

function isFinished(pb, roomId) {
  return pb._store.rooms.find((r) => r.id === roomId)?.status === 'finished';
}

describe('11. Boty (master add bot)', () => {
  let ctx;

  beforeEach(async () => {
    resetInMemoryGameState();
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    resetInMemoryGameState();
  });

  it('add_bot — tylko host może dodać; bot pojawia się w playerList jako isBot:true; nie tworzy konta PB', async () => {
    const { roomId, code, masterSocket } = await createRoom(ctx.url, { min_players: 4 });
    const [{ socket: guestSocket }] = await joinPlayers(ctx.url, code, makePlayers(1));

    const guestRes = await emitAck(guestSocket, 'add_bot');
    expect(guestRes.ok).toBe(false);
    expect(guestRes.error).toBe('not_master');

    const playerJoinedEvents = [];
    masterSocket.on('player_joined', (p) => playerJoinedEvents.push(p));

    const r1 = await emitAck(masterSocket, 'add_bot');
    expect(r1.ok).toBe(true);
    expect(r1.bot.username).toMatch(/^Bot \d+$/);

    await waitFor(() => playerJoinedEvents.some((p) => p.isBot === true));

    const botJoin = playerJoinedEvents.find((p) => p.isBot === true);
    expect(botJoin.players.some((p) => p.isBot === true)).toBe(true);

    // Bot NIE ma rekordu w PB (room_players ani users) — to kluczowa właściwość.
    const pbRps = ctx.pb._store.room_players?.filter((p) => p.room_id === roomId) || [];
    expect(pbRps.every((p) => !p.is_bot)).toBe(true);

    const pbUsers = ctx.pb._store.users || [];
    expect(pbUsers.every((u) => !u.email?.endsWith('@bots.local'))).toBe(true);

    // Bot żyje w state.players
    const state = rooms.get(roomId);
    expect([...state.players.values()].some((p) => p.isBot)).toBe(true);

    guestSocket.disconnect();
    masterSocket.disconnect();
  });

  it('start_game pomija player_offline check dla botów (sami boty + 1 host + 1 gracz)', async () => {
    const { masterSocket, code } = await createRoom(ctx.url, { min_players: 4 });
    const [{ socket: humanSocket }] = await joinPlayers(ctx.url, code, makePlayers(1));

    for (let i = 0; i < 5; i++) {
      const r = await emitAck(masterSocket, 'add_bot');
      expect(r.ok).toBe(true);
    }

    const startRes = await startGame(masterSocket);
    expect(startRes.ok).toBe(true);

    humanSocket.disconnect();
    masterSocket.disconnect();
  });

  it('add_bot blokowane po starcie gry (not_in_lobby)', async () => {
    const { masterSocket, code } = await createRoom(ctx.url, { min_players: 4 });
    await joinPlayers(ctx.url, code, makePlayers(1));
    for (let i = 0; i < 5; i++) await emitAck(masterSocket, 'add_bot');
    await startGame(masterSocket);

    const res = await emitAck(masterSocket, 'add_bot');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_in_lobby');

    masterSocket.disconnect();
  });

  it('pełny przebieg gry tylko z botami (1 host + 8 botów) — boty same wykonują akcje, kończy się game_over', async () => {
    const { roomId, masterSocket } = await createRoom(ctx.url, { min_players: 8 });

    for (let i = 0; i < 8; i++) {
      const r = await emitAck(masterSocket, 'add_bot');
      expect(r.ok).toBe(true);
    }

    const events = [];
    masterSocket.on('phase_changed', (p) => events.push(['phase_changed', p]));
    masterSocket.on('night_resolved', (p) => events.push(['night_resolved', p]));
    masterSocket.on('vote_resolved', (p) => events.push(['vote_resolved', p]));
    masterSocket.on('game_over', (p) => events.push(['game_over', p]));

    await startGame(masterSocket);

    // 8 botów powinno mieć role
    const state = rooms.get(roomId);
    const botIds = [...state.players.keys()].filter((id) => state.players.get(id).isBot);
    expect(botIds.length).toBe(8);

    function currentRoundId() {
      const rounds = ctx.pb._store.rounds.filter((r) => r.room_id === roomId);
      return rounds.length ? rounds[rounds.length - 1].id : null;
    }

    function aliveBotsWithRole(role) {
      const s = rooms.get(roomId);
      if (!s) return 0;
      let n = 0;
      for (const [id, info] of s.players.entries()) {
        if (!info.isBot) continue;
        if (s.roles?.[id] !== role) continue;
        if (s.eliminatedBots?.has(id)) continue;
        n++;
      }
      return n;
    }

    const MAX_ROUNDS = 12;
    let gameOver = null;

    for (let r = 0; r < MAX_ROUNDS && !gameOver; r++) {
      const ph1 = await advancePhase(masterSocket);
      if (!ph1.ok) break;
      await waitFor(
        () => isFinished(ctx.pb, roomId) || aliveBotsWithRole('detective') === 0 || !!rooms.get(roomId)?.nightActions?.detective,
        { label: `r${r} investigate` }
      );

      const ph2 = await advancePhase(masterSocket);
      if (!ph2.ok) break;
      await waitFor(
        () => isFinished(ctx.pb, roomId) || aliveBotsWithRole('doctor') === 0 || !!rooms.get(roomId)?.nightActions?.doctor,
        { label: `r${r} protect` }
      );

      const ph3 = await advancePhase(masterSocket);
      if (!ph3.ok) break;
      await waitFor(
        () => isFinished(ctx.pb, roomId) || aliveBotsWithRole('mafia') === 0 || !!rooms.get(roomId)?.nightActions?.mafia,
        { label: `r${r} kill` }
      );

      const ph4 = await advancePhase(masterSocket);
      if (!ph4.ok) break;
      gameOver = events.find(([e]) => e === 'game_over');
      if (gameOver) break;

      // day_deliberation (boty nic tu nie robią)
      const ph5 = await advancePhase(masterSocket);
      if (!ph5.ok) break;

      // day_vote — boty głosują
      const ph6 = await advancePhase(masterSocket);
      if (!ph6.ok) break;
      await waitFor(() => {
        if (isFinished(ctx.pb, roomId)) return true;
        const s = rooms.get(roomId);
        if (!s || s.phase !== 'day_vote') return true;
        return s.votes.size >= aliveVoterCount(roomId);
      }, { label: `r${r} votes` });

      // day_vote → day_resolve
      const ph7 = await advancePhase(masterSocket);
      if (!ph7.ok) break;
      gameOver = events.find(([e]) => e === 'game_over');
    }

    gameOver = gameOver || events.find(([e]) => e === 'game_over');
    expect(gameOver, `events: ${JSON.stringify(events.map(([e]) => e))}`).toBeDefined();
    expect(['town', 'mafia']).toContain(gameOver[1].winner);

    masterSocket.disconnect();
  }, 15000);
});
