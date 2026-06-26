import { rooms } from '../game/state.js';
import { assignRoles } from '../game/roles.js';
import { resolveNight } from '../game/night.js';
import { resolveVotes, checkWinCondition } from '../game/day.js';
import { roomEventMeta, emitMasterInsight } from '../game/events.js';
import { processNightAction, processVote } from '../game/actions.js';
import { scheduleBotPhaseActions } from '../game/bots.js';

const PHASES = [
  'night_detective',
  'night_doctor',
  'night_mafia',
  'night_resolve',
  'day_deliberation',
  'day_vote',
  'day_resolve',
];

function clearPhaseTimer(state) {
  if (state?.phaseTimer) clearTimeout(state.phaseTimer);
  state.phaseTimer = null;
  state.phaseTimerPhase = null;
  state.phaseTimerDeadline = null;
}

function phaseDurationMs(state, phase) {
  const s = state?.settings || {};
  const sec = (k, fallback) =>
    typeof s[k] === 'number' && Number.isFinite(s[k]) ? s[k] : fallback;

  switch (phase) {
    case 'night_detective':
      return sec('phase_timer_detective_sec', 30) * 1000;
    case 'night_doctor':
      return sec('phase_timer_doctor_sec', 30) * 1000;
    case 'night_mafia':
      return sec('phase_timer_mafia_sec', 120) * 1000;
    case 'day_deliberation':
      return sec('phase_timer_deliberation_sec', 300) * 1000;
    default:
      return null;
  }
}

async function advancePhaseInternal(io, state, pb, callback) {
  const currentIdx = state.phase ? PHASES.indexOf(state.phase) : -1;
  let nextIdx = currentIdx + 1;

  if (state.phase === 'night_resolve') {
    const result = await resolveNight(state, pb);
    state.previousDoctorProtectTarget = state.nightActions.doctor?.targetId ?? null;

    const pubMeta = roomEventMeta(state);
    io.to(`room:${state.code}`).emit('night_resolved', {
      eliminatedPlayerId: result.eliminatedId,
      survivedNight: result.eliminatedId === null,
      ...pubMeta,
    });

    // Wyraźny wynik nocy dla mastera (wpis w feedzie + event).
    const killedName = result.killed
      ? (state.players.get(result.killed)?.username || result.killed)
      : null;
    const protectedName = result.protected
      ? (state.players.get(result.protected)?.username || result.protected)
      : null;
    emitMasterInsight(io, state, {
      kind: 'night_result',
      eliminatedId: result.eliminatedId,
      killedName,
      protectedName,
      protection_was_effective: result.protection_was_effective,
    });

    const win = await checkWinCondition(state, pb);
    if (win) {
      return emitGameOver(io, state, win, pb, callback);
    }

    state.nightActions = {};
    state.mafiaTargets = new Map();
  }

  if (state.phase === 'day_resolve') {
    const result = await resolveVotes(state, pb);
    const pubMeta = roomEventMeta(state);
    io.to(`room:${state.code}`).emit('vote_resolved', {
      eliminatedPlayerId: result.eliminatedId,
      outcome: result.outcome,
      ...pubMeta,
    });

    // Wyraźny wynik głosowania dla mastera.
    const eliminatedName = result.eliminatedId
      ? (state.players.get(result.eliminatedId)?.username || result.eliminatedId)
      : null;
    emitMasterInsight(io, state, {
      kind: 'vote_result',
      eliminatedId: result.eliminatedId,
      eliminatedName,
      outcome: result.outcome,
    });

    const win = await checkWinCondition(state, pb);
    if (win) {
      return emitGameOver(io, state, win, pb, callback);
    }

    state.votes = new Map();
    state.round += 1;
    nextIdx = 0;

    const round = await pb.collection('rounds').create({
      room_id: state.id,
      round_number: state.round,
      phase: PHASES[0],
    });
    state.currentRoundId = round.id;
  }

  if (nextIdx >= PHASES.length) {
    nextIdx = 0;
    state.round += 1;
  }

  const nextPhase = PHASES[nextIdx];
  state.phase = nextPhase;

  if (state.currentRoundId) {
    await pb.collection('rounds').update(state.currentRoundId, { phase: nextPhase });
  }

  const meta = roomEventMeta(state);
  io.to(`room:${state.code}`).emit('phase_changed', {
    phase: nextPhase,
    round: state.round,
    ...meta,
  });

  await emitNightActionPrompts(io, state, pb);

  scheduleBotPhaseActions(io, state, pb, nextPhase);

  clearPhaseTimer(state);
  const ms = phaseDurationMs(state, nextPhase);
  if (ms) {
    state.phaseTimerPhase = nextPhase;
    state.phaseTimerDeadline = Date.now() + ms;
    state.phaseTimer = setTimeout(async () => {
      if (state.status !== 'in_progress') return;
      if (state.phase !== nextPhase) return;
      try {
        await advancePhaseInternal(io, state, pb);
      } catch (err) {
        console.error('[game] phase timer auto-advance error:', err.message);
      }
    }, ms);
  }

  callback?.({ ok: true, phase: nextPhase, round: state.round });
}

async function isEliminated(pb, roomId, userId) {
  const rp = await pb.collection('room_players').getList(1, 1, {
    filter: `room_id = "${roomId}" && user_id = "${userId}"`,
  });
  return !!(rp.items[0]?.eliminated_at);
}

async function emitNightActionPrompts(io, state, pb) {
  const meta = roomEventMeta(state);

  if (state.phase === 'night_detective') {
    const detectiveId = Object.entries(state.roles || {}).find(([, r]) => r === 'detective')?.[0];
    if (!detectiveId) return;
    if (await isEliminated(pb, state.id, detectiveId)) return;
    const p = state.players.get(detectiveId);
    if (p?.socketId && !p.isBot) {
      io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'detective', ...meta });
    }
  }

  if (state.phase === 'night_doctor') {
    const doctorId = Object.entries(state.roles || {}).find(([, r]) => r === 'doctor')?.[0];
    if (!doctorId) return;
    if (await isEliminated(pb, state.id, doctorId)) return;
    const p = state.players.get(doctorId);
    if (p?.socketId && !p.isBot) {
      io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'doctor', ...meta });
    }
  }

  if (state.phase === 'night_mafia') {
    for (const [uid, r] of Object.entries(state.roles || {})) {
      if (r !== 'mafia') continue;
      if (await isEliminated(pb, state.id, uid)) continue;
      const p = state.players.get(uid);
      if (p?.socketId && !p.isBot) {
        io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'mafia', ...meta });
      }
    }
  }
}

export function registerGameHandlers(io, socket, pb) {
  socket.on('start_game', async (_, callback) => {
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
    const roleMap = assignRoles(participantIds);

    for (const [userId, role] of Object.entries(roleMap)) {
      const rpRecords = await pb.collection('room_players').getList(1, 1, {
        filter: `room_id = "${state.id}" && user_id = "${userId}"`,
      });
      if (rpRecords.items.length > 0) {
        await pb.collection('room_players').update(rpRecords.items[0].id, { role });
      }
    }

    await pb.collection('rooms').update(state.id, { status: 'in_progress' });

    state.status = 'in_progress';
    state.roles = roleMap;
    state.round = 1;
    state.phase = null;
    state.nightActions = {};
    state.votes = new Map();
    state.mafiaTargets = new Map();
    state.previousDoctorProtectTarget = null;
    state.eliminatedBots = new Set();
    state.botMemory = null;

    const round = await pb.collection('rounds').create({
      room_id: state.id,
      round_number: 1,
      phase: 'night_detective',
    });
    state.currentRoundId = round.id;

    const meta = roomEventMeta(state);

    // Każdy prawdziwy gracz (nie-master, nie-bot) dostaje swoją rolę.
    for (const [userId, pInfo] of state.players.entries()) {
      if (userId === state.hostId) continue;
      if (pInfo.isBot) continue;
      const role = roleMap[userId];
      io.to(pInfo.socketId).emit('game_started', { role, ...meta });
    }

    // Master dostaje game_started bez roli (null) — żeby mógł się przekierować
    // na stronę gry i korzystać z panelu mastera.
    const masterInfo = state.players.get(state.hostId);
    if (masterInfo?.socketId) {
      io.to(masterInfo.socketId).emit('game_started', { role: null, isMaster: true, ...meta });
    }

    emitMasterInsight(io, state, { kind: 'roles_assigned', roles: roleMap });

    callback?.({ ok: true });
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
      requestKey: null,
    });

    const rounds = await pb.collection('rounds').getFullList({
      filter: `room_id = "${state.id}"`,
      sort: 'round_number',
      requestKey: null,
    });

    // Jeśli serwer się zrestartował (faza utracona z pamięci), odtwórz z ostatniej rundy w PB.
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

    // Scalamy listę graczy z PB + boty z state.players (boty nie mają rekordów PB).
    const pbPlayerIds = new Set(players.map((p) => p.user_id));
    const allPlayers = [
      ...players.map((p) => ({
        id: p.user_id,
        username: state.players.get(p.user_id)?.username || p.user_id,
        isMaster: p.is_master,
        isBot: false,
        eliminated: !!p.eliminated_at,
        seatOrder: p.seat_order,
      })),
      ...Array.from(state.players.entries())
        .filter(([id, info]) => info.isBot && !pbPlayerIds.has(id))
        .map(([id, info]) => ({
          id,
          username: info.username,
          isMaster: false,
          isBot: true,
          eliminated: Boolean(state.eliminatedBots?.has(id)),
          seatOrder: 999,
        })),
    ];

    callback?.({
      ok: true,
      phase: state.phase,
      round: state.round,
      status: state.status,
      role: state.roles?.[socket.userId] || null,
      your_action_history: { detective: detectiveHistory, doctor: doctorHistory },
      players: allPlayers,
      ...roomEventMeta(state),
    });
  });
}

async function emitGameOver(io, state, winner, pb, callback) {
  await pb.collection('rooms').update(state.id, { status: 'finished' });
  state.status = 'finished';
  clearPhaseTimer(state);

  const meta = roomEventMeta(state);
  io.to(`room:${state.code}`).emit('game_over', {
    winner,
    roles: state.roles,
    ...meta,
  });

  callback?.({ ok: true, winner });
}
