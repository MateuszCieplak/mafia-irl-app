import { roomEventMeta, notifyMasterSubmission, emitMasterInsight } from './events.js';

function isPlayerBot(state, userId) {
  return Boolean(state.players.get(userId)?.isBot);
}

function isBotEliminated(state, botId) {
  return Boolean(state.eliminatedBots?.has(botId));
}

/**
 * Sprawdza, czy prawdziwy gracz (nie-bot) jest wyeliminowany — wymaga zapytania do PB.
 */
async function isRealPlayerEliminated(pb, roomId, userId) {
  const rp = await pb.collection('room_players').getList(1, 1, {
    filter: `room_id = "${roomId}" && user_id = "${userId}"`,
    requestKey: null,
  });
  return !!(rp.items[0]?.eliminated_at);
}

/**
 * Sprawdza, czy prawdziwy gracz istnieje w room_players i nie jest wyeliminowany.
 * Zwraca { exists, eliminated }.
 */
async function checkRealPlayerTarget(pb, roomId, targetId) {
  const rp = await pb.collection('room_players').getList(1, 1, {
    filter: `room_id = "${roomId}" && user_id = "${targetId}"`,
    requestKey: null,
  });
  return {
    exists: !!rp.items[0],
    eliminated: !!(rp.items[0]?.eliminated_at),
  };
}

/**
 * Wykonuje akcję nocną gracza/bota. Boty:
 * - nie są sprawdzane przez PB (brak rekordów room_players),
 * - nie piszą do kolekcji night_actions (brak FK user_id w PB).
 */
export async function processNightAction(io, state, pb, actorId, targetId) {
  if (state.status === 'finished') return { ok: false, error: 'game_finished' };
  if (actorId === state.hostId) return { ok: false, error: 'master_cannot_act' };

  const role = state.roles?.[actorId];
  if (!role) return { ok: false, error: 'no_role' };

  // --- sprawdzenie, czy aktor jest wyeliminowany ---
  if (isPlayerBot(state, actorId)) {
    if (isBotEliminated(state, actorId)) return { ok: false, error: 'eliminated' };
  } else {
    if (await isRealPlayerEliminated(pb, state.id, actorId)) {
      return { ok: false, error: 'eliminated' };
    }
  }

  if (role === 'detective' && state.phase !== 'night_detective') {
    return { ok: false, error: 'wrong_phase' };
  }
  if (role === 'doctor' && state.phase !== 'night_doctor') {
    return { ok: false, error: 'wrong_phase' };
  }
  if (role === 'mafia' && state.phase !== 'night_mafia') {
    return { ok: false, error: 'wrong_phase' };
  }
  if (role === 'citizen') {
    return { ok: false, error: 'no_action' };
  }

  // --- walidacja celu (detective i mafia muszą podać żywego gracza) ---
  if (role === 'detective' || role === 'mafia') {
    if (isPlayerBot(state, targetId)) {
      if (!state.players.has(targetId)) return { ok: false, error: 'invalid_target' };
      if (isBotEliminated(state, targetId)) return { ok: false, error: 'target_eliminated' };
    } else {
      const t = await checkRealPlayerTarget(pb, state.id, targetId);
      if (!t.exists) return { ok: false, error: 'invalid_target' };
      if (t.eliminated) return { ok: false, error: 'target_eliminated' };
    }
  }

  const actorIsBot = isPlayerBot(state, actorId);

  if (role === 'detective') {
    if (state.nightActions.detective) {
      return { ok: false, error: 'already_acted' };
    }
    const targetRole = state.roles[targetId];
    if (targetRole === undefined) return { ok: false, error: 'invalid_target' };
    const isMafia = targetRole === 'mafia';

    // Wpis do PB tylko gdy zarówno aktor, jak i cel są prawdziwymi graczami
    // (boty nie mają rekordu w _pb_users_auth_, więc target_id/actor_id jako FK by się nie zapisało).
    if (!actorIsBot && !isPlayerBot(state, targetId)) {
      try {
        await pb.collection('night_actions').create({
          round_id: state.currentRoundId,
          actor_id: actorId,
          action_type: 'investigate',
          target_id: targetId,
          result: { is_mafia: isMafia },
        });
      } catch (err) {
        // Błąd zapisu do PB nie powinien blokować akcji nocnej — wynik jest już znany.
        console.error('[detective] night_actions.create failed:', err.message);
      }
    }

    state.nightActions.detective = { actorId, targetId };
    notifyMasterSubmission(io, state, 'detective', { actorId, targetId, isMafia });
    emitMasterInsight(io, state, {
      kind: 'night_detective',
      actorId,
      targetId,
      isMafia,
    });
    return { ok: true, result: { is_mafia: isMafia } };
  }

  if (role === 'doctor') {
    const settings = state.settings || {};
    if (settings.doctor_can_self_protect === false && targetId === actorId) {
      return { ok: false, error: 'cannot_self_protect' };
    }
    if (settings.doctor_repeat_protect === false && state.previousDoctorProtectTarget === targetId) {
      return { ok: false, error: 'repeat_protect_forbidden' };
    }

    if (!actorIsBot && !isPlayerBot(state, targetId)) {
      try {
        await pb.collection('night_actions').create({
          round_id: state.currentRoundId,
          actor_id: actorId,
          action_type: 'protect',
          target_id: targetId,
        });
      } catch (err) {
        console.error('[doctor] night_actions.create failed:', err.message);
      }
    }

    state.nightActions.doctor = { actorId, targetId };
    notifyMasterSubmission(io, state, 'doctor', { actorId, targetId });
    emitMasterInsight(io, state, {
      kind: 'night_doctor',
      actorId,
      targetId,
    });
    return { ok: true };
  }

  if (role === 'mafia') {
    state.mafiaTargets.set(actorId, targetId);

    const livingMafia = Object.entries(state.roles)
      .filter(([, r]) => r === 'mafia')
      .map(([uid]) => uid)
      .filter((uid) => state.players.has(uid));

    const eliminatedMafia = [];
    for (const uid of livingMafia) {
      if (isPlayerBot(state, uid)) {
        if (isBotEliminated(state, uid)) eliminatedMafia.push(uid);
      } else {
        const rp = await pb.collection('room_players').getList(1, 1, {
          filter: `room_id = "${state.id}" && user_id = "${uid}" && eliminated_at != ""`,
          requestKey: null,
        });
        if (rp.items.length > 0) eliminatedMafia.push(uid);
      }
    }
    const aliveMafia = livingMafia.filter((uid) => !eliminatedMafia.includes(uid));

    const allSubmitted = aliveMafia.every((uid) => state.mafiaTargets.has(uid));
    const targets = aliveMafia.map((uid) => state.mafiaTargets.get(uid));
    const consensus = allSubmitted && new Set(targets).size === 1;

    if (consensus) {
      const mafiaTarget = targets[0];
      if (!actorIsBot && !isPlayerBot(state, mafiaTarget)) {
        try {
          await pb.collection('night_actions').create({
            round_id: state.currentRoundId,
            actor_id: actorId,
            action_type: 'kill',
            target_id: mafiaTarget,
          });
        } catch (err) {
          console.error('[mafia] night_actions.create failed:', err.message);
        }
      }
      state.nightActions.mafia = { targetId: mafiaTarget };
      notifyMasterSubmission(io, state, 'mafia', {
        targetId: mafiaTarget,
        votes: Object.fromEntries(state.mafiaTargets),
      });
    }

    const mafiaVotes = Object.fromEntries(state.mafiaTargets);
    const meta = roomEventMeta(state);
    for (const uid of aliveMafia) {
      const pInfo = state.players.get(uid);
      if (pInfo?.socketId && !pInfo.isBot) {
        io.to(pInfo.socketId).emit('mafia_vote_update', {
          votes: mafiaVotes,
          consensus,
          waitingForConsensus: allSubmitted && !consensus,
          ...meta,
        });
      }
    }

    emitMasterInsight(io, state, {
      kind: 'night_mafia',
      votes: mafiaVotes,
      consensus,
      waitingForConsensus: allSubmitted && !consensus,
      finalKillTarget: consensus ? targets[0] : null,
    });

    return { ok: true, consensus };
  }

  return { ok: false, error: 'unknown_role' };
}

/**
 * Wykonuje głos gracza/bota. Boty:
 * - nie są sprawdzane przez PB,
 * - nie piszą do kolekcji votes (brak FK voter_id w PB).
 */
export async function processVote(io, state, pb, voterId, targetId) {
  if (state.status === 'finished') return { ok: false, error: 'game_finished' };
  if (voterId === state.hostId) return { ok: false, error: 'master_cannot_vote' };
  if (state.phase !== 'day_vote') return { ok: false, error: 'wrong_phase' };

  if (isPlayerBot(state, voterId)) {
    if (isBotEliminated(state, voterId)) return { ok: false, error: 'eliminated' };
  } else {
    if (await isRealPlayerEliminated(pb, state.id, voterId)) {
      return { ok: false, error: 'eliminated' };
    }
  }

  if (state.votes.has(voterId)) {
    return { ok: false, error: 'already_voted' };
  }

  const normalizedTarget = targetId || null;
  if (state.settings?.self_vote === false && normalizedTarget === voterId) {
    return { ok: false, error: 'self_vote_forbidden' };
  }

  state.votes.set(voterId, normalizedTarget);

  if (!isPlayerBot(state, voterId)) {
    try {
      await pb.collection('votes').create({
        round_id: state.currentRoundId,
        voter_id: voterId,
        // target_id to opcjonalna relacja — przy pominięciu (skip) nie wysyłamy pola
        ...(normalizedTarget ? { target_id: normalizedTarget } : {}),
      });
    } catch (err) {
      // Błąd zapisu do PB nie powinien blokować głosu — in-memory vote już jest ustawiony.
      console.error('[vote] votes.create failed (głos zachowany w pamięci):', err.message);
    }
  }

  const meta = roomEventMeta(state);
  io.to(`room:${state.code}`).emit('vote_submitted', {
    voterId,
    totalVotes: state.votes.size,
    ...meta,
  });

  emitMasterInsight(io, state, {
    kind: 'day_vote',
    voterId,
    targetId: normalizedTarget,
  });

  return { ok: true };
}
