import { roomEventMeta, notifyMasterSubmission, emitMasterInsight } from './events.js';
import { currentTurnActorId, prevDoctorTarget } from './turns.js';

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


/** Żywi mafiosi (boty sprawdzane w pamięci, prawdziwi gracze równolegle w PB). */
export async function getAliveMafiaIds(state, pb) {
  const livingMafia = Object.entries(state.roles || {})
    .filter(([, r]) => r === 'mafia')
    .map(([uid]) => uid)
    .filter((uid) => state.players.has(uid));

  const flags = await Promise.all(
    livingMafia.map(async (uid) => {
      if (isPlayerBot(state, uid)) return isBotEliminated(state, uid);
      const rp = await pb.collection('room_players').getList(1, 1, {
        filter: `room_id = "${state.id}" && user_id = "${uid}" && eliminated_at != ""`,
        requestKey: null,
      });
      return rp.items.length > 0;
    }),
  );
  return livingMafia.filter((_, i) => !flags[i]);
}

/**
 * Przelicza konsensus mafii po KAŻDEJ zmianie głosu (nowy / zmiana celu / cofnięcie),
 * synchronizuje state.nightActions.mafia, wpis kill w PB (bez duplikatów) i rozsyła
 * `mafia_vote_update` do żywych mafiosów (nie-botów) + insight dla mastera.
 */
async function syncMafiaConsensus(io, state, pb, actorId, { retracted = false } = {}) {
  const aliveMafia = await getAliveMafiaIds(state, pb);

  const allSubmitted =
    aliveMafia.length > 0 && aliveMafia.every((uid) => state.mafiaTargets.has(uid));
  const targets = aliveMafia.map((uid) => state.mafiaTargets.get(uid));
  const consensus = allSubmitted && new Set(targets).size === 1;
  const prevMafiaAction = state.nightActions.mafia;

  const killRec = state.mafiaKillRecord && state.mafiaKillRecord.roundId === state.currentRoundId
    ? state.mafiaKillRecord
    : null;

  if (consensus) {
    const mafiaTarget = targets[0];
    state.nightActions.mafia = { targetId: mafiaTarget };
    // Jeden wpis kill na rundę: przy zmianie celu aktualizujemy, nie dublujemy.
    if (!isPlayerBot(state, mafiaTarget) && !isPlayerBot(state, actorId)) {
      try {
        if (killRec) {
          if (killRec.targetId !== mafiaTarget) {
            await pb.collection('night_actions').update(killRec.id, {
              actor_id: actorId,
              target_id: mafiaTarget,
            });
            killRec.targetId = mafiaTarget;
          }
        } else {
          const rec = await pb.collection('night_actions').create({
            round_id: state.currentRoundId,
            actor_id: actorId,
            action_type: 'kill',
            target_id: mafiaTarget,
          });
          state.mafiaKillRecord = { id: rec.id, roundId: state.currentRoundId, targetId: mafiaTarget };
        }
      } catch (err) {
        console.error('[mafia] night_actions kill write failed:', err.message);
      }
    } else if (killRec) {
      // Cel zmienił się na bota — stary wpis kill byłby nieaktualny.
      try { await pb.collection('night_actions').delete(killRec.id); } catch (err) {
        console.error('[mafia] night_actions.delete failed:', err.message);
      }
      state.mafiaKillRecord = null;
    }
    notifyMasterSubmission(io, state, 'mafia', {
      targetId: mafiaTarget,
      votes: Object.fromEntries(
        aliveMafia.filter((u) => state.mafiaTargets.has(u)).map((u) => [u, state.mafiaTargets.get(u)]),
      ),
    });
  } else {
    delete state.nightActions.mafia;
    if (killRec) {
      try { await pb.collection('night_actions').delete(killRec.id); } catch (err) {
        console.error('[mafia] night_actions.delete failed:', err.message);
      }
      state.mafiaKillRecord = null;
    }
    if (prevMafiaAction || retracted) {
      notifyMasterSubmission(io, state, 'mafia', { submitted: false, votes: {} });
    }
  }

  // Wszyscy żywi mafiosi wybrali, ale różne cele — muszą wybrać ponownie.
  // Flaga żyje do końca nocy (reset razem z mafiaTargets) i trafia do get_game_state.
  state.mafiaWaitingForConsensus = allSubmitted && !consensus;

  const mafiaVotes = Object.fromEntries(
    aliveMafia.filter((u) => state.mafiaTargets.has(u)).map((u) => [u, state.mafiaTargets.get(u)]),
  );
  const meta = roomEventMeta(state);
  for (const uid of aliveMafia) {
    const pInfo = state.players.get(uid);
    if (pInfo?.socketId && !pInfo.isBot) {
      io.to(pInfo.socketId).emit('mafia_vote_update', {
        votes: mafiaVotes,
        consensus,
        waitingForConsensus: state.mafiaWaitingForConsensus,
        ...meta,
      });
    }
  }

  emitMasterInsight(io, state, {
    kind: 'night_mafia',
    votes: mafiaVotes,
    consensus,
    waitingForConsensus: state.mafiaWaitingForConsensus,
    finalKillTarget: consensus ? targets[0] : null,
    ...(retracted ? { retractedBy: actorId } : {}),
  });

  return { consensus, targets };
}

/** Cofnięcie głosu mafii (event `mafia_retract_vote`). */
export async function retractMafiaVote(io, state, pb, actorId) {
  if (state.status === 'finished') return { ok: false, error: 'game_finished' };
  if (state.roles?.[actorId] !== 'mafia' || actorId === state.hostId) {
    return { ok: false, error: 'not_mafia' };
  }
  if (state.phase !== 'night_mafia') return { ok: false, error: 'wrong_phase' };

  const eliminated = isPlayerBot(state, actorId)
    ? isBotEliminated(state, actorId)
    : await isRealPlayerEliminated(pb, state.id, actorId);
  if (eliminated) return { ok: false, error: 'eliminated' };

  // Idempotentnie: brak głosu = nic do cofania (ok:true, bez emitów).
  if (!state.mafiaTargets.has(actorId)) return { ok: true, noVote: true };

  state.mafiaTargets.delete(actorId);
  await syncMafiaConsensus(io, state, pb, actorId, { retracted: true });
  return { ok: true };
}

/**
 * Czy detektyw już wcześniej sprawdzał ten cel w tej grze?
 * Najpierw pamięć (dziennik obejmuje też boty), potem PB (przetrwa restart serwera).
 */
async function detectiveAlreadyChecked(pb, state, actorId, targetId) {
  const log = state.detectiveLog?.get(actorId) ?? [];
  if (log.some((h) => h.targetId === targetId)) return true;
  if (isPlayerBot(state, actorId) || isPlayerBot(state, targetId)) return false;
  try {
    const rounds = await pb.collection('rounds').getFullList({
      filter: `room_id = "${state.id}"`,
      requestKey: null,
    });
    const roundIds = new Set((rounds || []).map((r) => r.id));
    if (roundIds.size === 0) return false;
    const past = await pb.collection('night_actions').getFullList({
      filter: `actor_id = "${actorId}"`,
      requestKey: null,
    });
    return (past || []).some(
      (a) =>
        a.action_type === 'investigate' &&
        a.target_id === targetId &&
        roundIds.has(a.round_id),
    );
  } catch (err) {
    console.error('[detective] already-checked lookup failed:', err.message);
    return false;
  }
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
  // Wielu lekarzy/detektywów: każdy ma własną turę w fazie.
  if (
    (role === 'detective' || role === 'doctor') &&
    currentTurnActorId(state, role) !== actorId
  ) {
    return { ok: false, error: 'not_your_turn' };
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

    // Tej samej osoby nie można sprawdzić ponownie (w żadnej kolejnej nocy).
    if (await detectiveAlreadyChecked(pb, state, actorId, targetId)) {
      return { ok: false, error: 'already_checked' };
    }

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

    // Wyniki śledztw trzymamy też w pamięci — PB pomija boty, a zapis mógł się nie udać.
    if (!state.detectiveLog) state.detectiveLog = new Map();
    const log = state.detectiveLog.get(actorId) || [];
    log.push({ targetId, result: { is_mafia: isMafia } });
    state.detectiveLog.set(actorId, log);

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
    if (settings.doctor_repeat_protect === false && prevDoctorTarget(state, actorId) === targetId) {
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
    state.nightActions.protections = { ...(state.nightActions.protections || {}), [actorId]: targetId };
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
    const { consensus } = await syncMafiaConsensus(io, state, pb, actorId);
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

  const normalizedTarget = targetId || null;
  if (state.settings?.self_vote === false && normalizedTarget === voterId) {
    return { ok: false, error: 'self_vote_forbidden' };
  }

  // Zmiana głosu: ten sam cel = nic do zrobienia, inny cel = nadpisanie głosu.
  const hadVote = state.votes.has(voterId);
  if (hadVote && state.votes.get(voterId) === normalizedTarget) {
    return { ok: true, unchanged: true };
  }

  state.votes.set(voterId, normalizedTarget);

  if (!isPlayerBot(state, voterId)) {
    if (!state.voteRecords) state.voteRecords = new Map();
    const rec = state.voteRecords.get(voterId);
    const existing = rec && rec.roundId === state.currentRoundId ? rec : null;
    try {
      if (existing) {
        // target_id to opcjonalna relacja — przy pominięciu (skip) czyścimy pole.
        await pb.collection('votes').update(existing.id, { target_id: normalizedTarget || null });
      } else {
        const created = await pb.collection('votes').create({
          round_id: state.currentRoundId,
          voter_id: voterId,
          // target_id to opcjonalna relacja — przy pominięciu (skip) nie wysyłamy pola
          ...(normalizedTarget ? { target_id: normalizedTarget } : {}),
        });
        state.voteRecords.set(voterId, { id: created.id, roundId: state.currentRoundId });
      }
    } catch (err) {
      // Błąd zapisu do PB nie powinien blokować głosu — in-memory vote już jest ustawiony.
      console.error('[vote] votes.create/update failed (głos zachowany w pamięci):', err.message);
    }
  }

  await emitMafiaDayVotes(io, state, pb, voterId);

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
    ...(hadVote ? { changed: true } : {}),
  });

  return { ok: true };
}

/** Mafia widzi między sobą, na kogo głosują współmafiosi (głosowanie dzienne). */
async function emitMafiaDayVotes(io, state, pb, voterId) {
  if (state.roles?.[voterId] !== 'mafia') return;
  const mafiaDayVotes = Object.fromEntries(
    [...state.votes].filter(([id]) => state.roles?.[id] === 'mafia'),
  );
  const mafiaMeta = roomEventMeta(state);
  for (const uid of await getAliveMafiaIds(state, pb)) {
    const info = state.players.get(uid);
    if (info?.socketId && !info.isBot) {
      io.to(info.socketId).emit('mafia_day_votes', { votes: mafiaDayVotes, ...mafiaMeta });
    }
  }
}

/** Cofnięcie głosu w głosowaniu dziennym (event `retract_vote`). */
export async function retractVote(io, state, pb, voterId) {
  if (state.status === 'finished') return { ok: false, error: 'game_finished' };
  if (voterId === state.hostId) return { ok: false, error: 'master_cannot_vote' };
  if (state.phase !== 'day_vote') return { ok: false, error: 'wrong_phase' };

  const eliminated = isPlayerBot(state, voterId)
    ? isBotEliminated(state, voterId)
    : await isRealPlayerEliminated(pb, state.id, voterId);
  if (eliminated) return { ok: false, error: 'eliminated' };

  // Idempotentnie: brak głosu = nic do cofania.
  if (!state.votes.has(voterId)) return { ok: true, noVote: true };

  state.votes.delete(voterId);

  const rec = state.voteRecords?.get(voterId);
  if (rec) {
    state.voteRecords.delete(voterId);
    if (rec.roundId === state.currentRoundId) {
      try {
        await pb.collection('votes').delete(rec.id);
      } catch (err) {
        console.error('[vote] votes.delete failed:', err.message);
      }
    }
  }

  await emitMafiaDayVotes(io, state, pb, voterId);

  io.to(`room:${state.code}`).emit('vote_retracted', {
    voterId,
    totalVotes: state.votes.size,
    ...roomEventMeta(state),
  });

  emitMasterInsight(io, state, { kind: 'day_vote', voterId, retracted: true });

  return { ok: true };
}
