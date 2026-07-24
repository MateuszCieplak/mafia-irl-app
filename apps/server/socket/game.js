import { rooms } from '../game/state.js';
import { assignRoles } from '../game/roles.js';
import { roomEventMeta, emitMasterInsight } from '../game/events.js';
import { processNightAction, processVote } from '../game/actions.js';
import { buildRoomPlayerList } from '../game/roomPlayers.js';
import { ensureAdminAuth } from '../lib/pocketbase.js';
import {
  advancePhaseInternal,
  clearPhaseTimer,
  emitGameOver,
  phaseMeta,
  tryAutoAdvance,
} from '../game/phaseFlow.js';

export function registerGameHandlers(io, socket, pb) {
  socket.on('start_game', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      if (socket.userId !== state.hostId) return callback?.({ ok: false, error: 'not_master' });
      if (state.players.size < (state.settings?.min_players || 4)) {
        return callback?.({ ok: false, error: 'not_enough_players' });
      }

      for (const [, p] of state.players.entries()) {
        if (p.isBot) continue;
        if (!p.socketId) {
          return callback?.({ ok: false, error: 'player_offline' });
        }
      }

      const participantIds = Array.from(state.players.keys()).filter((id) => id !== state.hostId);
      const roleOverrides = (data && typeof data === 'object') ? (data.roleOverrides || {}) : {};
      const roleMap = assignRoles(participantIds, roleOverrides);

      for (const [userId, role] of Object.entries(roleMap)) {
        const rpRecords = await pb.collection('room_players').getList(1, 1, {
          filter: `room_id = "${state.id}" && user_id = "${userId}"`,
        });
        if (rpRecords.items.length > 0) {
          await pb.collection('room_players').update(rpRecords.items[0].id, { role });
        }
      }

      // Rundę tworzymy PRZED przełączeniem pokoju w in_progress — gdyby zapis do PB
      // padł (np. nieznana wartość `phase`), pokój zostaje w lobby zamiast utknąć
      // w stanie "gra wystartowała, ale nikt nie dostał eventu game_started".
      const round = await pb.collection('rounds').create({
        room_id: state.id,
        round_number: 1,
        phase: 'role_reveal',
      });

      await pb.collection('rooms').update(state.id, { status: 'in_progress' });

      state.status = 'in_progress';
      state.roles = roleMap;
      state.round = 1;
      state.phase = 'role_reveal';
      state.nightActions = {};
      state.votes = new Map();
      state.mafiaTargets = new Map();
      state.previousDoctorProtectTarget = null;
      state.eliminatedBots = new Set();
      state.botMemory = null;
      state.phaseResult = null;
      state.currentRoundId = round.id;

      const meta = roomEventMeta(state);

      for (const [userId, pInfo] of state.players.entries()) {
        if (userId === state.hostId) continue;
        if (pInfo.isBot) continue;
        const role = roleMap[userId];
        io.to(pInfo.socketId).emit('game_started', { role, ...meta });
      }

      const masterInfo = state.players.get(state.hostId);
      if (masterInfo?.socketId) {
        io.to(masterInfo.socketId).emit('game_started', { role: null, isMaster: true, ...meta });
      }

      emitMasterInsight(io, state, { kind: 'roles_assigned', roles: roleMap });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[game] start_game error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('advance_phase', async (_, callback) => {
    const state = rooms.get(socket.roomId);
    if (!state) return callback?.({ ok: false, error: 'no_room' });
    if (socket.userId !== state.hostId) return callback?.({ ok: false, error: 'not_master' });
    if (state.status !== 'in_progress') return callback?.({ ok: false, error: 'game_not_started' });
    clearPhaseTimer(state);
    await advancePhaseInternal(io, state, pb, callback);
  });

  socket.on('end_game', async (_data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      if (socket.userId !== state.hostId) {
        return callback?.({ ok: false, error: 'not_master' });
      }
      if (state.status === 'finished') {
        return callback?.({ ok: false, error: 'already_finished' });
      }
      clearPhaseTimer(state);
      await emitGameOver(io, state, 'master_ended', pb, callback);
    } catch (err) {
      console.error('[game] end_game error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // Master wraca z ekranu "koniec gry" do pokoju — resetujemy pokój tak,
  // żeby zachowywał się jak świeżo utworzony (ustawienia edytowalne, boty
  // można dodawać, role/eliminacje z poprzedniej gry wyczyszczone).
  socket.on('return_to_room', async (_data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      if (socket.userId !== state.hostId) return callback?.({ ok: false, error: 'not_master' });
      if (state.status !== 'finished') return callback?.({ ok: false, error: 'game_not_finished' });

      clearPhaseTimer(state);
      await ensureAdminAuth();
      await pb.collection('rooms').update(state.id, { status: 'lobby' });

      const participants = await pb.collection('room_players').getFullList({
        filter: `room_id = "${state.id}"`,
        requestKey: null,
      });
      for (const p of participants) {
        await pb.collection('room_players').update(p.id, { role: '', eliminated_at: null });
      }

      // Boty istnieją tylko w pamięci — usuwamy je razem z resztą stanu gry.
      for (const [userId, info] of Array.from(state.players.entries())) {
        if (info.isBot) state.players.delete(userId);
      }

      state.status = 'lobby';
      state.phase = null;
      state.round = 0;
      state.roles = {};
      state.winner = undefined;
      state.nightActions = {};
      state.votes = new Map();
      state.mafiaTargets = new Map();
      state.previousDoctorProtectTarget = null;
      state.eliminatedBots = new Set();
      state.botMemory = null;
      state.phaseResult = null;
      state.currentRoundId = null;

      io.to(`room:${state.code}`).emit('room_reset_to_lobby', {
        players: buildRoomPlayerList(state),
      });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[game] return_to_room error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('night_action', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      const result = await processNightAction(io, state, pb, socket.userId, data?.targetId);
      callback?.(result);
    } catch (err) {
      console.error('[game] night_action error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('vote', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      const result = await processVote(io, state, pb, socket.userId, data?.targetId);
      callback?.(result);
    } catch (err) {
      console.error('[game] vote error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('get_game_state', async (_, callback) => {
    const state = rooms.get(socket.roomId);
    if (!state) return callback?.({ ok: false, error: 'no_room' });

    const players = await pb.collection('room_players').getFullList({
      filter: `room_id = "${state.id}"`,
      expand: 'user_id',
      requestKey: null,
    });

    const rounds = await pb.collection('rounds').getFullList({
      filter: `room_id = "${state.id}"`,
      sort: 'round_number',
      requestKey: null,
    });

    if (state.status === 'in_progress' && !state.phase && rounds.length > 0) {
      const lastRound = rounds[rounds.length - 1];
      state.phase = lastRound.phase || null;
      state.round = lastRound.round_number || 1;
      state.currentRoundId = lastRound.id;
      console.log(`[game] odtworzono fazę z PB: ${state.phase} (runda ${state.round})`);
    }

    const roundIds = new Set(rounds.map((r) => r.id));
    const allActions = await pb.collection('night_actions').getFullList({ requestKey: null });
    const detectiveHistory = allActions
      .filter(
        (a) =>
          roundIds.has(a.round_id) &&
          a.actor_id === socket.userId &&
          a.action_type === 'investigate',
      )
      .map((a) => ({ targetId: a.target_id, result: a.result }));

    const doctorHistory = allActions
      .filter(
        (a) =>
          roundIds.has(a.round_id) &&
          a.actor_id === socket.userId &&
          a.action_type === 'protect',
      )
      .map((a) => ({ targetId: a.target_id, roundId: a.round_id }));

    const pbBase = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
    const isMaster = socket.userId === state.hostId;
    const isFinished = state.status === 'finished';
    // Po zakończeniu gry role są ujawnione wszystkim, nie tylko masterowi.
    const canSeeRoles = isMaster || isFinished;

    const pbPlayerIds = new Set(players.map((p) => p.user_id));
    const allPlayers = [
      ...players.map((p) => {
        const userExp = p.expand?.user_id;
        const avatarFile = userExp?.avatar;
        const avatarUrl =
          avatarFile && typeof avatarFile === 'string'
            ? `${pbBase}/api/files/users/${userExp.id}/${avatarFile}`
            : null;
        return {
          id: p.user_id,
          username: state.players.get(p.user_id)?.username || p.user_id,
          isMaster: p.is_master,
          isBot: false,
          eliminated: !!p.eliminated_at,
          seatOrder: p.seat_order,
          avatarUrl,
          role: canSeeRoles ? state.roles?.[p.user_id] || p.role : undefined,
        };
      }),
      ...Array.from(state.players.entries())
        .filter(([id, info]) => info.isBot && !pbPlayerIds.has(id))
        .map(([id, info]) => ({
          id,
          username: info.username,
          isMaster: false,
          isBot: true,
          eliminated: Boolean(state.eliminatedBots?.has(id)),
          seatOrder: 999,
          avatarUrl: null,
          role: canSeeRoles ? state.roles?.[id] : undefined,
        })),
    ];

    callback?.({
      ok: true,
      phase: state.phase,
      round: state.round,
      status: state.status,
      winner: isFinished ? state.winner ?? null : undefined,
      role: state.roles?.[socket.userId] || null,
      isMaster,
      settings: state.settings,
      your_action_history: { detective: detectiveHistory, doctor: doctorHistory },
      lastDoctorTarget: state.previousDoctorProtectTarget ?? null,
      players: allPlayers,
      roles: canSeeRoles ? state.roles : undefined,
      // Wynik bieżącej fazy rozstrzygnięcia — pozwala odtworzyć ekran werdyktu
      // po obudzeniu telefonu / odświeżeniu strony, zanim master przejdzie dalej.
      phaseResult: state.phaseResult ?? null,
      ...phaseMeta(state),
    });
  });
}
