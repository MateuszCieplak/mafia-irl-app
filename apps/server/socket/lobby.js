import { rooms } from '../game/state.js';
import { presenceSetRoom, presenceClearRoom, removePendingInvite } from '../game/presence.js';
import { buildRoomPlayerList } from '../game/roomPlayers.js';
import { addBotToRoom } from '../game/bots.js';
import { ensureAdminAuth } from '../lib/pocketbase.js';
import { clearDisconnectTimer, scheduleLobbyRemoval } from '../game/lobbyGrace.js';
import { displayNameFromUserRecord } from '../lib/userDisplayName.js';
import { normalizeCardSettings } from '../game/cards.js';

const ACTIVE_ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const STATUS_PRIORITY = { in_progress: 0, finished: 1, lobby: 2 };

function roomCreatorEmailAllowed(socket) {
  if (process.env.MAFIA_TEST_AUTH === '1') return true;
  const allowed = (process.env.ALLOWED_ROOM_CREATOR_EMAIL || '').trim().toLowerCase();
  // Fail closed: without a configured host email nobody may create rooms.
  if (!allowed) return false;
  return socket.userEmail === allowed;
}

/** Timery tylko przy jawnym `true` — stare pokoje bez klucza = wyłączone. */
function normalizeRoomSettings(settings) {
  const next = { ...(settings || {}) };
  next.phase_timers_enabled = next.phase_timers_enabled === true;
  next.detective_first_night_immunity = next.detective_first_night_immunity === true;
  next.mafia_count_manual = next.mafia_count_manual === true;
  if (next.mafia_count !== undefined) {
    next.mafia_count = Math.max(1, Math.floor(Number(next.mafia_count) || 1));
  }
  next.doctor_count = Math.max(1, Math.floor(Number(next.doctor_count) || 1));
  next.detective_count = Math.max(1, Math.floor(Number(next.detective_count) || 1));
  normalizeCardSettings(next);
  return next;
}

export function registerLobbyHandlers(io, socket, pb) {
  socket.on('create_room', async (data, callback) => {
    if (!roomCreatorEmailAllowed(socket)) {
      return callback?.({ ok: false, error: 'forbidden_create_room' });
    }
    try {
      await ensureAdminAuth();
      const code = generateRoomCode();
      const roomSettings = normalizeRoomSettings(
        data?.settings || {
          min_players: 4,
          max_players: 15,
          doctor_can_self_protect: true,
          doctor_repeat_protect: false,
          detective_first_night_immunity: false,
          // Timers off by default — master advances phases from the cockpit.
          phase_timers_enabled: false,
          // Phase timers (seconds). Used only when phase_timers_enabled is true.
          phase_timer_detective_sec: 30,
          phase_timer_doctor_sec: 30,
          phase_timer_mafia_sec: 120,
          phase_timer_deliberation_sec: 300,
          phase_timer_vote_sec: 60,
          // Lobby grace period before removing a disconnected guest (ms).
          lobby_disconnect_grace_ms: 120000,
        },
      );
      const room = await pb.collection('rooms').create({
        code,
        host_id: socket.userId,
        status: 'lobby',
        settings: roomSettings,
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
        settings: normalizeRoomSettings(room.settings),
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
      await ensureAdminAuth();
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
      const memStatus = rooms.get(room.id)?.status;
      const isLobby = (memStatus ?? room.status) === 'lobby';

      const existing = await pb.collection('room_players').getList(1, 1, {
        filter: `room_id = "${room.id}" && user_id = "${socket.userId}"`,
        requestKey: null,
      });

      let state = rooms.get(room.id);
      const freshState = !state;
      if (!state) {
        state = {
          id: room.id,
          code,
          hostId: room.host_id,
          status: 'lobby',
          settings: normalizeRoomSettings(room.settings),
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

      // Stan w pamięci jest źródłem prawdy, dopóki serwer żyje. Z bazy bierzemy go
      // tylko po restarcie (świeży stan) — inaczej join_room, który odczytał
      // jeszcze 'finished', a skończył się już po „Wróć do pokoju” mastera,
      // cofał pokój z lobby do stanu „gra zakończona”.
      if (freshState) {
        state.status = room.status;
        state.settings = normalizeRoomSettings(room.settings);
        state.hostId = room.host_id;
      }

      // Rejoin = update socketId for "online" presence.
      state.players.set(socket.userId, { socketId: socket.id, username: socket.username });
      // If there was a pending lobby disconnect cleanup, cancel it on successful join/rejoin.
      clearDisconnectTimer(state, socket.userId);

      // Po restarcie serwera mapa graczy w pamięci jest pusta — odtwarzamy
      // uczestników z bazy (offline), żeby lista i obecność były poprawne.
      if (freshState) {
        try {
          const participants = await pb.collection('room_players').getFullList({
            filter: `room_id = "${room.id}"`,
            expand: 'user_id',
            requestKey: null,
          });
          for (const p of participants) {
            if (state.players.has(p.user_id)) continue;
            const username = p.expand?.user_id
              ? displayNameFromUserRecord(p.expand.user_id)
              : p.user_id;
            state.players.set(p.user_id, { socketId: null, username });
            if (state.status === 'lobby') scheduleLobbyRemoval(io, pb, state, p.user_id);
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
      // Gracz jest już w pokoju — zaproszenie przestaje być potrzebne.
      removePendingInvite(socket.userId, code);
      state.invites?.delete(socket.userId);

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

  // Gracz świadomie wychodzi z pokoju. W lobby znika całkiem (także z bazy),
  // w trakcie/po grze zostaje uczestnikiem — tylko odłączamy ten socket.
  // `code` pozwala wyjść z pokoju, do którego ten socket jeszcze nie dołączył
  // (np. z banera „Jesteś w pokoju…” po ponownym otwarciu aplikacji).
  socket.on('leave_room', async (data, callback) => {
    try {
      const code = socket.roomCode || data?.code;
      if (!code) return callback?.({ ok: true });
      const state = Array.from(rooms.values()).find((r) => r.code === code);

      if (state && state.players.has(socket.userId)) {
        clearDisconnectTimer(state, socket.userId);
        if (state.status === 'lobby' && socket.userId !== state.hostId) {
          state.players.delete(socket.userId);
          try {
            await ensureAdminAuth();
            const rp = await pb.collection('room_players').getList(1, 1, {
              filter: `room_id = "${state.id}" && user_id = "${socket.userId}"`,
              requestKey: null,
            });
            if (rp.items[0]) await pb.collection('room_players').delete(rp.items[0].id);
          } catch (err) {
            console.error('[lobby] leave_room cleanup:', err.message);
          }
          io.to(`room:${code}`).emit('player_left', { userId: socket.userId });
        } else {
          const p = state.players.get(socket.userId);
          if (p && p.socketId === socket.id) {
            p.socketId = null;
            io.to(`room:${code}`).emit('room_players_sync', { players: buildRoomPlayerList(state) });
          }
        }
      }

      socket.leave(`room:${code}`);
      if (socket.roomCode === code) {
        presenceClearRoom(socket.userId);
        socket.roomCode = null;
        socket.roomId = null;
      }
      callback?.({ ok: true });
    } catch (err) {
      console.error('[lobby] leave_room error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // Po ponownym otwarciu aplikacji (zamknięty Chrome, nowa karta) klient pyta,
  // czy gracz jest w jakimś pokoju — wtedy pokazuje „Wróć do gry”.
  socket.on('get_my_active_room', async (_data, callback) => {
    try {
      const found = [];
      for (const st of rooms.values()) {
        if (!st.players.has(socket.userId)) continue;
        found.push({ code: st.code, status: st.status, isMaster: st.hostId === socket.userId });
      }

      // Restart serwera: pamięć pusta — szukamy w bazie świeżych, niezakończonych pokoi.
      if (found.length === 0) {
        try {
          await ensureAdminAuth();
          const rps = await pb.collection('room_players').getFullList({
            filter: `user_id = "${socket.userId}"`,
            expand: 'room_id',
            requestKey: null,
          });
          const now = Date.now();
          for (const rp of rps) {
            const room = rp.expand?.room_id;
            if (!room || !['in_progress', 'lobby'].includes(room.status)) continue;
            const updated = Date.parse(room.updated || room.created || '');
            if (Number.isFinite(updated) && now - updated > ACTIVE_ROOM_MAX_AGE_MS) continue;
            found.push({ code: room.code, status: room.status, isMaster: room.host_id === socket.userId });
          }
        } catch (err) {
          console.error('[lobby] get_my_active_room db lookup failed:', err.message);
        }
      }

      found.sort((a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9));
      callback?.({ ok: true, room: found[0] ?? null });
    } catch (err) {
      console.error('[lobby] get_my_active_room error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
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

  socket.on('update_room_settings', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      if (socket.userId !== state.hostId) {
        return callback?.({ ok: false, error: 'not_master' });
      }
      if (state.status !== 'lobby') {
        return callback?.({ ok: false, error: 'not_in_lobby' });
      }

      const allowedKeys = [
        'min_players',
        'max_players',
        'doctor_can_self_protect',
        'doctor_repeat_protect',
        'detective_first_night_immunity',
        'mafia_count_manual',
        'mafia_count',
        'doctor_count',
        'detective_count',
        'phase_timers_enabled',
        'phase_timer_detective_sec',
        'phase_timer_doctor_sec',
        'phase_timer_mafia_sec',
        'phase_timer_deliberation_sec',
        'phase_timer_vote_sec',
        'self_vote',
        'advanced_mode',
        'card_min_round',
        'card_assignment',
        'card_citizen_count',
        'card_citizen_pool',
        'card_citizen_manual',
        'card_mafia_count',
        'card_mafia_pool',
        'card_mafia_manual',
      ];

      const nextSettings = { ...(state.settings || {}) };
      for (const key of allowedKeys) {
        if (data?.settings && Object.prototype.hasOwnProperty.call(data.settings, key)) {
          nextSettings[key] = data.settings[key];
        }
      }
      // Jawny boolean — unikamy truthy stringów / undefined z starych pokoi.
      nextSettings.phase_timers_enabled = nextSettings.phase_timers_enabled === true;
      nextSettings.detective_first_night_immunity = nextSettings.detective_first_night_immunity === true;
      nextSettings.mafia_count_manual = nextSettings.mafia_count_manual === true;
      nextSettings.mafia_count = Math.max(1, Math.floor(Number(nextSettings.mafia_count) || 1));
      nextSettings.doctor_count = Math.max(1, Math.floor(Number(nextSettings.doctor_count) || 1));
      nextSettings.detective_count = Math.max(1, Math.floor(Number(nextSettings.detective_count) || 1));
      normalizeCardSettings(nextSettings);

      await ensureAdminAuth();
      await pb.collection('rooms').update(state.id, { settings: nextSettings });
      state.settings = nextSettings;

      io.to(`room:${state.code}`).emit('room_settings_updated', { settings: nextSettings });
      callback?.({ ok: true, settings: nextSettings });
    } catch (err) {
      console.error('[lobby] update_room_settings error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // Master zamyka pokój na stałe: wszyscy gracze są wyrzucani na główny ekran,
  // a pokój znika z bazy, więc nie da się do niego ponownie dołączyć kodem.
  socket.on('close_room', async (_data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state || socket.userId !== state.hostId) {
        return callback?.({ ok: false, error: 'not_master' });
      }

      for (const userId of state.players.keys()) {
        clearDisconnectTimer(state, userId);
        presenceClearRoom(userId);
      }

      // Do wszystkich OPRÓCZ mastera — jego przekierowanie obsłuży callback z 'close_room'.
      socket.to(`room:${state.code}`).emit('room_closed', {});

      const roomSockets = await io.in(`room:${state.code}`).fetchSockets();
      for (const s of roomSockets) {
        s.leave(`room:${state.code}`);
        s.roomCode = null;
        s.roomId = null;
      }

      rooms.delete(state.id);

      await ensureAdminAuth();
      const players = await pb.collection('room_players').getFullList({
        filter: `room_id = "${state.id}"`,
        requestKey: null,
      });
      for (const p of players) {
        await pb.collection('room_players').delete(p.id);
      }
      await pb.collection('rooms').delete(state.id);

      callback?.({ ok: true });
    } catch (err) {
      console.error('[lobby] close_room error:', err.message);
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

      await ensureAdminAuth();
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
