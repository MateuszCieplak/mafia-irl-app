import { rooms } from '../game/state.js';
import { presenceSetRoom, presenceClearRoom } from '../game/presence.js';
import { buildRoomPlayerList } from '../game/roomPlayers.js';
import { addBotToRoom } from '../game/bots.js';
import { ensureAdminAuth } from '../lib/pocketbase.js';

function clearDisconnectTimer(state, userId) {
  const t = state?.disconnectTimers?.get(userId);
  if (t) clearTimeout(t);
  state?.disconnectTimers?.delete(userId);
}

function roomCreatorEmailAllowed(socket) {
  if (process.env.MAFIA_TEST_AUTH === '1') return true;
  const allowed = (process.env.ALLOWED_ROOM_CREATOR_EMAIL || 'm.cieplak97@gmail.com')
    .trim()
    .toLowerCase();
  return socket.userEmail === allowed;
}

export function registerLobbyHandlers(io, socket, pb) {
  socket.on('create_room', async (data, callback) => {
    if (!roomCreatorEmailAllowed(socket)) {
      return callback?.({ ok: false, error: 'forbidden_create_room' });
    }
    try {
      await ensureAdminAuth();
      const code = generateRoomCode();
      const room = await pb.collection('rooms').create({
        code,
        host_id: socket.userId,
        status: 'lobby',
        settings: data?.settings || {
          min_players: 4,
          max_players: 15,
          doctor_can_self_protect: true,
          doctor_repeat_protect: false,
          // Phase timers (seconds). These can be overridden from lobby settings UI.
          phase_timer_detective_sec: 30,
          phase_timer_doctor_sec: 30,
          phase_timer_mafia_sec: 120,
          phase_timer_deliberation_sec: 300,
          // Lobby grace period before removing a disconnected guest (ms).
          lobby_disconnect_grace_ms: 120000,
        },
      });

      await pb.collection('room_players').create({
        room_id: room.id,
        user_id: socket.userId,
        is_master: true,
        seat_order: 0,
      });

      rooms.set(room.id, {
        id: room.id,
        code,
        hostId: socket.userId,
        status: 'lobby',
        settings: room.settings,
        players: new Map([[socket.userId, { socketId: socket.id, username: socket.username }]]),
        phase: null,
        round: 0,
        nightActions: {},
        votes: new Map(),
        mafiaTargets: new Map(),
      });

      socket.join(`room:${code}`);
      socket.roomCode = code;
      socket.roomId = room.id;
      presenceSetRoom(socket.userId, code);

      callback?.({ ok: true, code, roomId: room.id });
    } catch (err) {
      console.error('[lobby] create_room error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('join_room', async (data, callback) => {
    try {
      const { code } = data;
      // requestKey: null wyłącza auto-anulowanie PocketBase SDK — bez tego
      // równoległe join_room (np. podwójny render w dev, szybkie reconnecty)
      // anulują wzajemnie swoje zapytania i handler wyrzuca błąd.
      const records = await pb.collection('rooms').getList(1, 1, {
        filter: `code = "${code}"`,
        requestKey: null,
      });
      if (records.items.length === 0) {
        return callback?.({ ok: false, error: 'room_not_found' });
      }

      const room = records.items[0];
      const isLobby = room.status === 'lobby';

      const existing = await pb.collection('room_players').getList(1, 1, {
        filter: `room_id = "${room.id}" && user_id = "${socket.userId}"`,
        requestKey: null,
      });

      let state = rooms.get(room.id);
      if (!state) {
        state = {
          id: room.id,
          code,
          hostId: room.host_id,
          status: 'lobby',
          settings: room.settings,
          players: new Map(),
          phase: null,
          round: 0,
          nightActions: {},
          votes: new Map(),
          mafiaTargets: new Map(),
        };
        rooms.set(room.id, state);
      }

      // Lobby: allow creating a new participant if not present yet.
      // In progress / finished: only allow re-joining if user is already a participant.
      if (existing.items.length === 0) {
        if (!isLobby) {
          return callback?.({ ok: false, error: 'not_a_participant' });
        }
        const seatOrder = state.players.size;
        await pb.collection('room_players').create({
          room_id: room.id,
          user_id: socket.userId,
          is_master: false,
          seat_order: seatOrder,
        });
      }

      // Keep server in-memory status/settings in sync with DB (covers restarts + rejoin).
      state.status = room.status;
      state.settings = room.settings;
      state.hostId = room.host_id;

      // Rejoin = update socketId for "online" presence.
      state.players.set(socket.userId, { socketId: socket.id, username: socket.username });
      // If there was a pending lobby disconnect cleanup, cancel it on successful join/rejoin.
      clearDisconnectTimer(state, socket.userId);

      // If this is a rejoin during an in-progress game and the in-memory player map is incomplete
      // (e.g. server restart), hydrate known participants so online/offline sync is correct.
      if (!isLobby && state.players.size === 1) {
        try {
          const participants = await pb.collection('room_players').getFullList({
            filter: `room_id = "${room.id}"`,
            requestKey: null,
          });
          for (const p of participants) {
            if (!state.players.has(p.user_id)) {
              state.players.set(p.user_id, { socketId: null, username: p.username || p.user_id });
            }
          }
        } catch (err) {
          // Non-fatal: presence list will at least include the rejoined user.
          console.error('[lobby] hydrate players on rejoin failed:', err.message);
        }
      }

      socket.join(`room:${code}`);
      socket.roomCode = code;
      socket.roomId = room.id;
      presenceSetRoom(socket.userId, code);

      const playerList = buildRoomPlayerList(state);

      // During lobby, this behaves like "join". During game, it's a "rejoin" + sync.
      if (isLobby) {
        io.to(`room:${code}`).emit('player_joined', {
          userId: socket.userId,
          username: socket.username,
          players: playerList,
        });
      } else {
        io.to(`room:${code}`).emit('room_players_sync', { players: playerList });
      }

      callback?.({ ok: true, roomId: room.id, players: playerList });
    } catch (err) {
      console.error('[lobby] join_room error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('leave_room', async () => {
    if (!socket.roomCode) return;
    const state = rooms.get(socket.roomId);
    if (state) {
      state.players.delete(socket.userId);
      io.to(`room:${socket.roomCode}`).emit('player_left', { userId: socket.userId });
    }
    socket.leave(`room:${socket.roomCode}`);
    presenceClearRoom(socket.userId);
    socket.roomCode = null;
    socket.roomId = null;
  });

  socket.on('add_bot', async (_data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      if (socket.userId !== state.hostId) {
        return callback?.({ ok: false, error: 'not_master' });
      }
      if (state.status !== 'lobby') {
        return callback?.({ ok: false, error: 'not_in_lobby' });
      }

      const bot = await addBotToRoom(io, state);
      callback?.({ ok: true, bot });
    } catch (err) {
      console.error('[lobby] add_bot error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('kick_player', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state || socket.userId !== state.hostId) {
        return callback?.({ ok: false, error: 'not_master' });
      }
      const targetUserId = data?.targetUserId;
      if (!targetUserId || targetUserId === state.hostId) {
        return callback?.({ ok: false, error: 'invalid_target' });
      }
      if (!state.players.has(targetUserId)) {
        return callback?.({ ok: false, error: 'not_in_room' });
      }

      const targetInfo = state.players.get(targetUserId);
      state.players.delete(targetUserId);
      presenceClearRoom(targetUserId);

      const rp = await pb.collection('room_players').getList(1, 1, {
        filter: `room_id = "${state.id}" && user_id = "${targetUserId}"`,
        requestKey: null,
      });
      if (rp.items[0]) {
        await pb.collection('room_players').delete(rp.items[0].id);
      }

      io.to(`room:${state.code}`).emit('player_left', { userId: targetUserId });

      if (targetInfo?.socketId) {
        const targetSocket = io.sockets.sockets.get(targetInfo.socketId);
        if (targetSocket) {
          targetSocket.leave(`room:${state.code}`);
          targetSocket.roomCode = null;
          targetSocket.roomId = null;
          targetSocket.emit('kicked_from_room', { roomCode: state.code });
        }
      }

      callback?.({ ok: true });
    } catch (err) {
      console.error('[lobby] kick_player error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
