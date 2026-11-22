/**
 * Podsumowanie rozgrywki na ekran końca gry: przebieg każdej rundy (ruchy nocne,
 * głosowanie, wynik), los graczy, statystyki i szanse stron po każdym etapie.
 *
 * Źródłem jest `state.insightLog` (ten sam dziennik co „Podgląd live” mastera),
 * więc podsumowanie powstaje bez dodatkowych zapisów w trakcie gry.
 */

const NIGHT_KINDS = new Set(['night_detective', 'night_doctor', 'night_mafia', 'night_result', 'card_check', 'card_mafia']);
const DAY_KINDS = new Set(['day_vote', 'vote_result', 'card_declared']);

/**
 * Szansa wygranej miasta w prostym modelu losowym: w nocy mafia zabija jednego
 * obywatela, w dzień miasto wyrzuca losowego żywego gracza. Nie uwzględnia
 * wiedzy detektywa ani ochrony lekarza — to punkt odniesienia „jak wygląda
 * układ sił”, nie wyrocznia. Warunki końca jak w checkWinCondition.
 */
export function townWinProbability(mafia, town, next) {
  const memo = new Map();
  function p(m, t, phase) {
    if (m <= 0) return 1;
    if (m >= t) return 0;
    const key = `${m}:${t}:${phase}`;
    if (memo.has(key)) return memo.get(key);
    let v;
    if (phase === 'night') {
      v = p(m, t - 1, 'day');
    } else {
      const n = m + t;
      v = (m / n) * p(m - 1, t, 'night') + (t / n) * p(m, t - 1, 'night');
    }
    memo.set(key, v);
    return v;
  }
  return p(mafia, town, next);
}

/**
 * Układ sił niezależny od tego, czy następna jest noc, czy dzień — średnia z obu
 * kolejności. Sam model losowy ma silny efekt parzystości (np. noc bez ofiary
 * potrafiła „obniżyć” szanse miasta tylko dlatego, że zmieniła się kolejność
 * faz), co na wykresie wyglądało jak błąd. Średnia zależy wyłącznie od liczby
 * żywych, więc rośnie, gdy ginie mafia, i spada, gdy ginie miasto.
 */
export function townOdds(mafia, town) {
  return (townWinProbability(mafia, town, 'night') + townWinProbability(mafia, town, 'day')) / 2;
}

function emptyRound(round) {
  return { round, night: null, day: null };
}

function ensureNight(r) {
  if (!r.night) {
    r.night = { mafiaTarget: null, mafiaVotes: {}, doctor: [], detective: [], cards: [], result: null };
  }
  return r.night;
}

function ensureDay(r) {
  if (!r.day) r.day = { votes: {}, cards: [], result: null };
  return r.day;
}

export function buildGameSummary(state, winner) {
  const roles = state.roles || {};
  const log = Array.isArray(state.insightLog) ? state.insightLog : [];
  const nameOf = (id) => state.players?.get(id)?.username || id;

  const participantIds = Object.keys(roles).filter((id) => id !== state.hostId);
  const fate = new Map(); // userId -> { type, round }
  const rounds = new Map();
  const roundOf = (n) => {
    const key = Number.isInteger(n) && n > 0 ? n : 1;
    if (!rounds.has(key)) rounds.set(key, emptyRound(key));
    return rounds.get(key);
  };

  for (const e of log) {
    if (!NIGHT_KINDS.has(e.kind) && !DAY_KINDS.has(e.kind)) continue;
    const r = roundOf(e.round);

    switch (e.kind) {
      case 'night_detective':
        ensureNight(r).detective.push({ actorId: e.actorId, targetId: e.targetId, isMafia: Boolean(e.isMafia) });
        break;
      case 'night_doctor': {
        const n = ensureNight(r);
        // Lekarz może zmienić decyzję — liczy się ostatni wybór danego lekarza.
        n.doctor = n.doctor.filter((d) => d.actorId !== e.actorId);
        n.doctor.push({ actorId: e.actorId, targetId: e.targetId });
        break;
      }
      case 'night_mafia': {
        const n = ensureNight(r);
        n.mafiaVotes = e.votes || {};
        n.mafiaTarget = e.consensus ? e.finalKillTarget ?? null : null;
        break;
      }
      case 'card_check':
        ensureNight(r).cards.push({
          kind: 'check',
          actorId: e.actorId,
          targetIds: e.targetIds || [],
          shownCount: e.shownCount,
          trueCount: e.trueCount,
          jammed: Boolean(e.jammed),
        });
        break;
      case 'card_mafia':
        ensureNight(r).cards.push({ kind: 'mafia', actorId: e.actorId, cardType: e.cardType, targetId: e.targetId ?? null });
        break;
      case 'night_result': {
        const n = ensureNight(r);
        const eliminatedId = e.eliminatedId ?? null;
        n.result = {
          eliminatedId,
          eliminatedRole: eliminatedId ? roles[eliminatedId] ?? null : null,
          saved: Boolean(e.protection_was_effective),
          immunity: e.detective_immunity_triggered === true,
        };
        if (eliminatedId) fate.set(eliminatedId, { type: 'night', round: r.round });
        break;
      }
      case 'day_vote': {
        const d = ensureDay(r);
        if (e.retracted) delete d.votes[e.voterId];
        else d.votes[e.voterId] = e.targetId ?? null;
        break;
      }
      case 'card_declared':
        ensureDay(r).cards.push({ kind: 'declared', actorId: e.actorId, cardType: e.cardType });
        break;
      case 'vote_result': {
        const d = ensureDay(r);
        const eliminatedId = e.eliminatedId ?? null;
        d.result = {
          outcome: e.outcome,
          eliminatedId,
          eliminatedRole: eliminatedId ? roles[eliminatedId] ?? null : null,
          shieldedId: e.shieldedId ?? null,
        };
        if (eliminatedId) fate.set(eliminatedId, { type: 'vote', round: r.round });
        break;
      }
      default:
        break;
    }
  }

  // Szanse po każdym etapie: start → noc 1 → dzień 1 → noc 2 …
  const alive = new Set(participantIds);
  const countSides = () => {
    let m = 0;
    let t = 0;
    for (const id of alive) (roles[id] === 'mafia' ? m++ : t++);
    return { m, t };
  };
  const point = (label, round, stage) => {
    const { m, t } = countSides();
    const townPct = Math.round(townOdds(m, t) * 100);
    return { label, round, stage, mafiaAlive: m, townAlive: t, townPct, mafiaPct: 100 - townPct };
  };

  const odds = [point('Start', 0, 'start')];
  const sortedRounds = [...rounds.values()].sort((a, b) => a.round - b.round);
  for (const r of sortedRounds) {
    if (r.night?.result) {
      if (r.night.result.eliminatedId) alive.delete(r.night.result.eliminatedId);
      odds.push(point(`Noc ${r.round}`, r.round, 'night'));
    }
    if (r.day?.result) {
      if (r.day.result.eliminatedId) alive.delete(r.day.result.eliminatedId);
      odds.push(point(`Dzień ${r.round}`, r.round, 'day'));
    }
  }

  const stats = {
    mafiaKills: 0,
    doctorSaves: 0,
    detectiveChecks: 0,
    detectiveHits: 0,
    lynches: 0,
    mafiaLynched: 0,
  };
  for (const r of sortedRounds) {
    if (r.night) {
      if (r.night.result?.eliminatedId) stats.mafiaKills++;
      if (r.night.result?.saved) stats.doctorSaves++;
      stats.detectiveChecks += r.night.detective.length;
      stats.detectiveHits += r.night.detective.filter((d) => d.isMafia).length;
    }
    if (r.day?.result?.eliminatedId) {
      stats.lynches++;
      if (r.day.result.eliminatedRole === 'mafia') stats.mafiaLynched++;
    }
  }

  const players = participantIds.map((id) => ({
    id,
    username: nameOf(id),
    role: roles[id] ?? null,
    isBot: Boolean(state.players?.get(id)?.isBot),
    fate: fate.get(id) ?? null,
  }));

  return {
    winner: winner ?? null,
    totalRounds: state.round ?? sortedRounds.length,
    players,
    rounds: sortedRounds,
    odds,
    stats,
  };
}
