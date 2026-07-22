import { resolveNight } from './night.js';
import { resolveVotes, checkWinCondition } from './day.js';
import { roomEventMeta, emitMasterInsight } from './events.js';
import { scheduleBotPhaseActions } from './bots.js';

export const PHASES = [
  'night_detective',
  'night_doctor',
  'night_mafia',
  'night_resolve',
  'day_deliberation',
  'day_vote',
  'day_resolve',
];

const RESOLVE_DELAY_MS = process.env.MAFIA_TEST_AUTH === '1' ? 0 : 2500;

function autoAdvanceEnabled() {
  return process.env.MAFIA_TEST_AUTH !== '1';
}

export function clearPhaseTimer(state) {
  if (state?.phaseTimer) clearTimeout(state.phaseTimer);
  if (state?.resolveTimer) clearTimeout(state.resolveTimer);
  state.phaseTimer = null;
  state.phaseTimerPhase = null;
  state.phaseTimerDeadline = null;
  state.resolveTimer = null;
}

export function phaseDurationMs(state, phase) {
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
    case 'day_vote':
      return sec('phase_timer_vote_sec', 60) * 1000;
    default:
      return null;
  }
}

export function phaseMeta(state) {
  return {
    ...roomEventMeta(state),
    phaseDeadline: state.phaseTimerDeadline ?? null,
  };
}

async function isEliminated(pb, roomId, userId, state) {
  const botInfo = state.players?.get(userId);
  if (botInfo?.isBot) {
    return Boolean(state.eliminatedBots?.has(userId));
  }
  const rp = await pb.collection('room_players').getList(1, 1, {
    filter: `room_id = "${roomId}" && user_id = "${userId}"`,
    requestKey: null,
  });
  return !!(rp.items[0]?.eliminated_at);
}

async function getAliveParticipantIds(state, pb) {
  const ids = Object.keys(state.roles || {}).filter((id) => id !== state.hostId);
  const alive = [];
  for (const id of ids) {
    if (!(await isEliminated(pb, state.id, id, state))) alive.push(id);
  }
  return alive;
}

async function getAliveMafiaIds(state, pb) {
  const mafia = Object.entries(state.roles || {})
    .filter(([, r]) => r === 'mafia')
    .map(([id]) => id);
  const alive = [];
  for (const id of mafia) {
    if (state.players.has(id) && !(await isEliminated(pb, state.id, id, state))) {
      alive.push(id);
    }
  }
  return alive;
}

export async function isNightPhaseActionComplete(state, pb, phase) {
  if (phase === 'night_detective') {
    const detectiveId = Object.entries(state.roles || {}).find(([, r]) => r === 'detective')?.[0];
    if (!detectiveId) return true;
    if (await isEliminated(pb, state.id, detectiveId, state)) return true;
    return Boolean(state.nightActions?.detective);
  }
  if (phase === 'night_doctor') {
    const doctorId = Object.entries(state.roles || {}).find(([, r]) => r === 'doctor')?.[0];
    if (!doctorId) return true;
    if (await isEliminated(pb, state.id, doctorId, state)) return true;
    return Boolean(state.nightActions?.doctor);
  }
  if (phase === 'night_mafia') {
    const aliveMafia = await getAliveMafiaIds(state, pb);
    if (aliveMafia.length === 0) return true;
    const allSubmitted = aliveMafia.every((uid) => state.mafiaTargets?.has(uid));
    if (!allSubmitted) return false;
    const targets = aliveMafia.map((uid) => state.mafiaTargets.get(uid));
    return new Set(targets).size === 1 && Boolean(state.nightActions?.mafia);
  }
  return false;
}

export async function areAllVotesIn(state, pb) {
  const alive = await getAliveParticipantIds(state, pb);
  if (alive.length === 0) return true;
  return alive.every((id) => state.votes?.has(id));
}

function schedulePhaseTimer(io, state, pb, phase, advanceFn) {
  clearPhaseTimer(state);
  const ms = phaseDurationMs(state, phase);
  if (!ms) return;
  state.phaseTimerPhase = phase;
  state.phaseTimerDeadline = Date.now() + ms;
  state.phaseTimer = setTimeout(async () => {
    if (state.status !== 'in_progress') return;
    if (state.phase !== phase) return;
    try {
      await advanceFn(io, state, pb);
    } catch (err) {
      console.error('[game] phase timer auto-advance error:', err.message);
    }
  }, ms);
}

async function emitNightActionPrompts(io, state, pb) {
  const meta = phaseMeta(state);

  if (state.phase === 'night_detective') {
    const detectiveId = Object.entries(state.roles || {}).find(([, r]) => r === 'detective')?.[0];
    if (!detectiveId) return;
    if (await isEliminated(pb, state.id, detectiveId, state)) return;
    const p = state.players.get(detectiveId);
    if (p?.socketId && !p.isBot) {
      io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'detective', ...meta });
    }
  }

  if (state.phase === 'night_doctor') {
    const doctorId = Object.entries(state.roles || {}).find(([, r]) => r === 'doctor')?.[0];
    if (!doctorId) return;
    if (await isEliminated(pb, state.id, doctorId, state)) return;
    const p = state.players.get(doctorId);
    if (p?.socketId && !p.isBot) {
      io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'doctor', ...meta });
    }
  }

  if (state.phase === 'night_mafia') {
    for (const [uid, r] of Object.entries(state.roles || {})) {
      if (r !== 'mafia') continue;
      if (await isEliminated(pb, state.id, uid, state)) continue;
      const p = state.players.get(uid);
      if (p?.socketId && !p.isBot) {
        io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'mafia', ...meta });
      }
    }
  }
}

async function emitGameOver(io, state, winner, pb, callback) {
  await pb.collection('rooms').update(state.id, { status: 'finished' });
  state.status = 'finished';
  state.winner = winner;
  clearPhaseTimer(state);

  const meta = phaseMeta(state);
  io.to(`room:${state.code}`).emit('game_over', {
    winner,
    roles: state.roles,
    ...meta,
  });

  callback?.({ ok: true, winner });
}

export async function advancePhaseInternal(io, state, pb, callback) {
  const currentIdx = state.phase ? PHASES.indexOf(state.phase) : -1;
  let nextIdx = currentIdx + 1;

  if (state.phase === 'night_resolve') {
    const result = await resolveNight(state, pb);
    state.previousDoctorProtectTarget = state.nightActions.doctor?.targetId ?? null;

    const pubMeta = phaseMeta(state);
    io.to(`room:${state.code}`).emit('night_resolved', {
      eliminatedPlayerId: result.eliminatedId,
      survivedNight: result.eliminatedId === null,
      ...pubMeta,
    });

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
    const pubMeta = phaseMeta(state);
    io.to(`room:${state.code}`).emit('vote_resolved', {
      eliminatedPlayerId: result.eliminatedId,
      outcome: result.outcome,
      ...pubMeta,
    });

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

  const meta = phaseMeta(state);
  io.to(`room:${state.code}`).emit('phase_changed', {
    phase: nextPhase,
    round: state.round,
    ...meta,
  });

  await emitNightActionPrompts(io, state, pb);
  scheduleBotPhaseActions(io, state, pb, nextPhase);

  schedulePhaseTimer(io, state, pb, nextPhase, advancePhaseInternal);

  // Auto-advance resolve phases after delay
  if (autoAdvanceEnabled() && (nextPhase === 'night_resolve' || nextPhase === 'day_resolve')) {
    const delay = RESOLVE_DELAY_MS;
    state.resolveTimer = setTimeout(async () => {
      if (state.status !== 'in_progress') return;
      if (state.phase !== nextPhase) return;
      try {
        await advancePhaseInternal(io, state, pb);
      } catch (err) {
        console.error('[game] resolve auto-advance error:', err.message);
      }
    }, RESOLVE_DELAY_MS);
  }

  // Check if next night phase already complete (edge case)
  if (autoAdvanceEnabled() && ['night_detective', 'night_doctor', 'night_mafia'].includes(nextPhase)) {
    await tryAutoAdvance(io, state, pb);
  }

  callback?.({ ok: true, phase: nextPhase, round: state.round });
}

/** Hybrid auto-advance: noc po akcjach, głosowanie po wszystkich głosach. */
export async function tryAutoAdvance(io, state, pb) {
  if (!autoAdvanceEnabled()) return;
  if (state.status !== 'in_progress') return;

  const phase = state.phase;
  if (['night_detective', 'night_doctor', 'night_mafia'].includes(phase)) {
    if (await isNightPhaseActionComplete(state, pb, phase)) {
      clearPhaseTimer(state);
      await advancePhaseInternal(io, state, pb);
    }
    return;
  }

  if (phase === 'day_vote') {
    if (await areAllVotesIn(state, pb)) {
      clearPhaseTimer(state);
      await advancePhaseInternal(io, state, pb);
    }
  }
}

export { emitGameOver, emitNightActionPrompts, isEliminated };
