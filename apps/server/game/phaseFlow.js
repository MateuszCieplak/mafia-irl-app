import { resolveNight } from './night.js';
import { resolveVotes, checkWinCondition } from './day.js';
import { roomEventMeta, emitMasterInsight } from './events.js';
import { scheduleBotPhaseActions } from './bots.js';
import { TURN_PHASE_ROLE, turnCount, currentTurnActorId } from './turns.js';
import {
  BASE_PHASES,
  CARD_PHASES,
  phasesFor,
  nextPhaseOf,
  dbPhase,
  resetNightCards,
  clearShields,
  emitCardQueue,
  settleShields,
  transferCards,
} from './cards.js';

export const PHASES = BASE_PHASES;

function autoAdvanceEnabled() {
  return process.env.MAFIA_TEST_AUTH !== '1';
}

/** Timery faz i auto-przejścia — tylko gdy master włączy je w ustawieniach pokoju. */
export function phaseTimersEnabled(state) {
  return state?.settings?.phase_timers_enabled === true;
}

export function clearPhaseTimer(state) {
  if (state?.phaseTimer) clearTimeout(state.phaseTimer);
  state.phaseTimer = null;
  state.phaseTimerPhase = null;
  state.phaseTimerDeadline = null;
}

export function phaseDurationMs(state, phase) {
  if (!phaseTimersEnabled(state)) return null;

  const s = state?.settings || {};
  const sec = (k, fallback) =>
    typeof s[k] === 'number' && Number.isFinite(s[k]) ? s[k] : fallback;

  switch (phase) {
    case 'night_detective':
      return sec('phase_timer_detective_sec', 60) * 1000;
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
    // Wielu lekarzy/detektywów: która tura w fazie (0-based) i ile ich jest.
    turn: state.nightTurn ?? 0,
    turnCount: turnCount(state, state.phase),
    // Kolejność faz zależy od trybu (tury kart) — master widzi na przycisku, co będzie dalej.
    nextPhase: nextPhaseOf(state),
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
  // Fazy nocne zostają w kokpicie mastera nawet bez żywego aktora — master
  // przeklikuje je ręcznie (lub czeka na timer). „Ukończone” = realna akcja
  // żywych graczy, nigdy samo „brak kogoś do zagrania”.
  if (phase === 'night_detective') {
    const detectiveId = currentTurnActorId(state, 'detective');
    if (!detectiveId) return false;
    if (await isEliminated(pb, state.id, detectiveId, state)) return false;
    return Boolean(state.nightActions?.detective);
  }
  if (phase === 'night_doctor') {
    const doctorId = currentTurnActorId(state, 'doctor');
    if (!doctorId) return false;
    if (await isEliminated(pb, state.id, doctorId, state)) return false;
    return Boolean(state.nightActions?.doctor);
  }
  if (phase === 'night_mafia') {
    const aliveMafia = await getAliveMafiaIds(state, pb);
    if (aliveMafia.length === 0) return false;
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

/** Żywi gracze, którzy jeszcze nie zagłosowali w day_vote. */
export async function getMissingVoterIds(state, pb) {
  const alive = await getAliveParticipantIds(state, pb);
  return alive.filter((id) => !state.votes?.has(id));
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
    const detectiveId = currentTurnActorId(state, 'detective');
    if (!detectiveId) return;
    if (await isEliminated(pb, state.id, detectiveId, state)) return;
    const p = state.players.get(detectiveId);
    if (p?.socketId && !p.isBot) {
      io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'detective', ...meta });
    }
  }

  if (state.phase === 'night_doctor') {
    const doctorId = currentTurnActorId(state, 'doctor');
    if (!doctorId) return;
    if (await isEliminated(pb, state.id, doctorId, state)) return;
    const p = state.players.get(doctorId);
    if (p?.socketId && !p.isBot) {
      io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'doctor', ...meta });
    }
  }

  if (state.phase === 'night_citizen_card') {
    const actorId = state.cardQueue?.check?.[state.nightTurn ?? 0]?.userId ?? null;
    if (actorId && !(await isEliminated(pb, state.id, actorId, state))) {
      const p = state.players.get(actorId);
      if (p?.socketId && !p.isBot) {
        io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'citizen_card', ...meta });
      }
    }
  }

  if (state.phase === 'night_mafia_card') {
    // Kartę mafii aktywuje jej właściciel — każda zgłoszona karta ma własną turę.
    const actorId = state.cardQueue?.mafia?.[state.nightTurn ?? 0]?.by ?? null;
    if (actorId && !(await isEliminated(pb, state.id, actorId, state))) {
      const p = state.players.get(actorId);
      if (p?.socketId && !p.isBot) {
        io.to(p.socketId).emit('night_action_prompt', { phase: state.phase, role: 'mafia_card', ...meta });
      }
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
  let phaseList = phasesFor(state);
  const currentIdx = state.phase ? phaseList.indexOf(state.phase) : -1;
  let nextIdx = currentIdx + 1;

  // Kolejny lekarz/detektyw/obywatel z kartą w tej samej fazie: zostajemy w fazie, zmienia się tura.
  const turnRole = TURN_PHASE_ROLE[state.phase];
  const nextTurn = (state.nightTurn ?? 0) + 1;
  const sameTurnAdvance =
    (Boolean(turnRole) || CARD_PHASES.includes(state.phase)) &&
    nextTurn < turnCount(state, state.phase);
  if (sameTurnAdvance) {
    nextIdx = currentIdx;
    state.nightTurn = nextTurn;
    if (turnRole) delete state.nightActions[turnRole];
  } else {
    state.nightTurn = 0;
  }

  if (!sameTurnAdvance && nextIdx >= phaseList.length) {
    // Master opuszcza day_resolve (obejrzał werdykt głosowania) — startujemy nową rundę.
    nextIdx = 0;
    state.round += 1;
    state.votes = new Map();
    // Od nowej rundy lista faz może zawierać tury kart.
    phaseList = phasesFor(state);

    const round = await pb.collection('rounds').create({
      room_id: state.id,
      round_number: state.round,
      phase: dbPhase(phaseList[0]),
    });
    state.currentRoundId = round.id;
  }

  const nextPhase = phaseList[nextIdx];
  state.phase = nextPhase;
  // Wynik należy do fazy rozstrzygnięcia, nie do momentu emisji eventu — dzięki
  // temu gracz, którego telefon spał w chwili `night_resolved`, dostanie go
  // z `get_game_state` po obudzeniu, dopóki master nie przejdzie dalej.
  state.phaseResult = null;
  // Znacznik wejścia w fazę rozstrzygnięcia — pilnuje minimalnego czasu jej
  // trwania (patrz RESOLVE_MIN_MS w socket/game.js), żeby przypadkowy podwójny
  // tap nie przeskoczył jej, zanim gracze w ogóle zobaczą wynik.
  state.resolveEnteredAt =
    nextPhase === 'night_resolve' || nextPhase === 'day_resolve' ? Date.now() : null;

  if (state.currentRoundId) {
    await pb.collection('rounds').update(state.currentRoundId, { phase: dbPhase(nextPhase) });
  }

  schedulePhaseTimer(io, state, pb, nextPhase, advancePhaseInternal);

  const meta = phaseMeta(state);
  io.to(`room:${state.code}`).emit('phase_changed', {
    phase: nextPhase,
    round: state.round,
    ...meta,
  });

  // Noc jest rozstrzygana natychmiast po wejściu w night_resolve; gra czeka w tej
  // fazie, dopóki master ręcznie nie przejdzie dalej (przycisk w MasterControls).
  if (nextPhase === 'night_resolve') {
    const result = await resolveNight(state, pb);
    // Zabity w nocy posiadacz nieużytej karty przekazuje ją żywemu graczowi swojej drużyny.
    if (result.eliminatedId) await transferCards(io, state, pb, result.eliminatedId);
    const protections = state.nightActions.protections || {};
    const protectedIds = Object.values(protections);
    state.previousDoctorTargets = { ...protections };
    state.previousDoctorProtectTarget =
      protectedIds[0] ?? state.nightActions.doctor?.targetId ?? null;

    state.phaseResult = {
      kind: 'night',
      eliminatedPlayerId: result.eliminatedId,
      survivedNight: result.eliminatedId === null,
    };
    // Utrwalone poza fazą night_resolve: phaseResult jest kasowany przy wejściu
    // w dyskusję, więc bez tego nakładka z werdyktem nocy nie dałaby się
    // odtworzyć po odświeżeniu strony w day_deliberation (get_game_state).
    state.lastNightResult = state.phaseResult;

    const pubMeta = phaseMeta(state);
    io.to(`room:${state.code}`).emit('night_resolved', {
      ...state.phaseResult,
      ...pubMeta,
    });

    const killedName = result.killed
      ? (state.players.get(result.killed)?.username || result.killed)
      : null;
    const protectedName =
      (result.protectedAll?.length ? result.protectedAll : result.protected ? [result.protected] : [])
        .map((id) => state.players.get(id)?.username || id)
        .join(', ') || null;
    emitMasterInsight(io, state, {
      kind: 'night_result',
      eliminatedId: result.eliminatedId,
      killedName,
      protectedName,
      protection_was_effective: result.protection_was_effective,
      detective_immunity_triggered: result.detective_immunity_triggered === true,
    });

    const win = await checkWinCondition(state, pb);
    if (win) {
      return emitGameOver(io, state, win, pb, callback);
    }

    state.nightActions = {};
    state.mafiaTargets = new Map();
    state.mafiaWaitingForConsensus = false;
    // Niewykonane zgłoszenia kart wygasają razem z nocą.
    resetNightCards(state);
  }

  // Głosowanie jest rozstrzygane natychmiast po wejściu w day_resolve; gra czeka
  // w tej fazie, dopóki master ręcznie nie przejdzie dalej ("Następna runda").
  if (nextPhase === 'day_resolve') {
    const result = await resolveVotes(state, pb);
    state.phaseResult = {
      kind: 'vote',
      eliminatedPlayerId: result.eliminatedId,
      // Publicznie tarcza jest nieodróżnialna od zwykłego braku eliminacji — prawdziwy
      // powód widzi tylko master (insight poniżej).
      outcome: result.outcome === 'shielded' ? 'no_elimination' : result.outcome,
    };
    // Tarcze działają tylko w głosowaniu, w którym je zgłoszono (zużyte także bez efektu).
    // Każdy, kto użył tarczy, prywatnie dowiaduje się, czy zadziałała i kim był wskazany gracz.
    const shieldReports = settleShields(io, state, {
      targetId: result.shieldedId ?? result.voteTargetId ?? null,
      saved: result.outcome === 'shielded',
    });
    clearShields(state);
    if (result.eliminatedId) await transferCards(io, state, pb, result.eliminatedId);

    const pubMeta = phaseMeta(state);
    io.to(`room:${state.code}`).emit('vote_resolved', {
      ...state.phaseResult,
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
      ...(shieldReports.length ? { shieldReports } : {}),
      ...(result.outcome === 'shielded'
        ? {
            shieldedId: result.shieldedId,
            shieldedName: state.players.get(result.shieldedId)?.username || result.shieldedId,
            shieldedBy: result.shieldedBy,
          }
        : {}),
    });

    const win = await checkWinCondition(state, pb);
    if (win) {
      return emitGameOver(io, state, win, pb, callback);
    }
  }

  if (CARD_PHASES.includes(nextPhase)) emitCardQueue(io, state);
  await emitNightActionPrompts(io, state, pb);
  scheduleBotPhaseActions(io, state, pb, nextPhase);

  // Auto-advance tylko gdy żywi gracze faktycznie wykonali akcję — nie gdy
  // brakuje aktora (wyeliminowany detektyw/lekarz itd.); te fazy zostają
  // w kokpicie do ręcznego przeklikania przez mastera (lub do wygaśnięcia timera).
  if (
    phaseTimersEnabled(state) &&
    autoAdvanceEnabled() &&
    ['night_detective', 'night_doctor', 'night_mafia'].includes(nextPhase)
  ) {
    await tryAutoAdvance(io, state, pb);
  }

  callback?.({ ok: true, phase: nextPhase, round: state.round });
}

/** Hybrid auto-advance: noc po akcjach, głosowanie po wszystkich głosach. */
export async function tryAutoAdvance(io, state, pb) {
  if (!phaseTimersEnabled(state)) return;
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
