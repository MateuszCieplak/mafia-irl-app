/**
 * Tryb „Mafia zaawansowana” — karty mocy.
 *
 * Karty (każda jednorazowa):
 *  - `check`        (obywatel)  Sprawdzenie: w nocy wskazuje 3 graczy i dostaje liczbę mafiozów w trójce.
 *  - `shield`       (obywatel)  Tarcza: unieważnia wyrzucenie z głosowania (wersja „B”: kogokolwiek).
 *  - `mafia_shield` (mafia)     Tarcza mafii — jak wyżej, wspólna dla całej drużyny.
 *  - `alibi`        (mafia)     wybrany mafioso przy najbliższym sprawdzeniu liczy się jako „czysty”.
 *  - `false_lead`   (mafia)     wybrany gracz przy najbliższym sprawdzeniu liczy się jako mafia.
 *  - `jam`          (mafia)     najbliższe sprawdzenie pokaże błędny wynik.
 *
 * Użycie: gracz zgłasza kartę przyciskiem w fazie głosowania (`declareCard`). Tarcze działają
 * od razu (w tym głosowaniu); Sprawdzenie i karty mafii czekają w kolejce na własną turę nocną
 * (`night_mafia_card` → `night_citizen_card`, mafia zawsze pierwsza, żeby jej efekt zdążył
 * zadziałać na sprawdzenie z tej samej nocy).
 *
 * Stan kart żyje tylko w pamięci serwera (jak `insightLog`) — nie dotyka schematu PocketBase.
 */
import { getAliveMafiaIds } from './actions.js';
import { emitMasterInsight, notifyMasterSubmission } from './events.js';

export const BASE_PHASES = [
  'night_detective',
  'night_doctor',
  'night_mafia',
  'night_resolve',
  'day_deliberation',
  'day_vote',
  'day_resolve',
];

export const CARD_PHASES = ['night_mafia_card', 'night_citizen_card'];

export const MAFIA_SPECIALS = ['alibi', 'jam', 'false_lead'];
const NIGHT_CARD_TYPES = new Set(['check', 'alibi', 'jam', 'false_lead']);
export const CHECK_GROUP_SIZE = 3;

/** Faza zapisywana w PocketBase (schemat nie zna faz kart) — karty mapujemy na `night_detective`. */
export function dbPhase(phase) {
  return CARD_PHASES.includes(phase) ? 'night_detective' : phase;
}

/** Znormalizowane ustawienia kart z `room.settings`. */
export function cardConfig(settings = {}) {
  const advanced = settings?.advanced_mode === true;
  const rawSpecial = settings?.card_mafia_special ?? 'alibi';
  const special = MAFIA_SPECIALS.includes(rawSpecial) ? rawSpecial : 'none';
  const count = Math.floor(Number(settings?.check_card_count));
  const minRound = Math.floor(Number(settings?.card_min_round));
  return {
    advanced,
    check: advanced && settings?.card_check_enabled !== false,
    checkCount: Number.isFinite(count) && count >= 1 ? count : 1,
    shieldCitizen: advanced && settings?.card_shield_citizen_enabled !== false,
    shieldMafia: advanced && settings?.card_shield_mafia_enabled !== false,
    special: advanced ? special : 'none',
    minRound: Number.isFinite(minRound) && minRound >= 1 ? minRound : 3,
  };
}

/**
 * Lista faz: tury kart pojawiają się na początku nocy tylko wtedy, gdy ktoś zgłosił użycie
 * karty (kolejka wypełnia się w głosowaniu, a czyści w `night_resolve`). Master ogłasza
 * wtedy jawnie, że użyto karty mocy — nie mówiąc jakiej — więc nie trzeba blefować.
 */
export function phasesFor(state) {
  const cfg = cardConfig(state?.settings);
  if (!cfg.advanced) return BASE_PHASES;
  const extra = [];
  if (cfg.special !== 'none' && state?.cardQueue?.mafia) extra.push('night_mafia_card');
  if (cfg.check && state?.cardQueue?.check?.length) extra.push('night_citizen_card');
  return extra.length ? [...extra, ...BASE_PHASES] : BASE_PHASES;
}

/** Następna faza (bez przeskakiwania tur) — master widzi ją na przycisku. */
export function nextPhaseOf(state) {
  const list = phasesFor(state);
  const idx = state?.phase ? list.indexOf(state.phase) : -1;
  if (idx === -1) return list[0];
  if (idx + 1 >= list.length) return phasesFor(state)[0];
  return list[idx + 1];
}

export function ensureCardState(state) {
  if (!state.cards) state.cards = {};
  if (!state.cardQueue) state.cardQueue = { check: [], mafia: null };
  if (!state.cardNight) state.cardNight = {};
  if (!state.cardLog) state.cardLog = {};
  if (!state.mafiaCardLog) state.mafiaCardLog = [];
  if (!state.cardEffects) state.cardEffects = { alibi: [], falseLead: [], jam: 0 };
  if (!state.shieldUsedBy) state.shieldUsedBy = [];
  if (state.teamCards === undefined) state.teamCards = null;
  return state;
}

export function resetCardState(state) {
  state.cards = {};
  state.teamCards = null;
  state.cardQueue = { check: [], mafia: null };
  state.cardNight = {};
  state.cardLog = {};
  state.mafiaCardLog = [];
  state.cardEffects = { alibi: [], falseLead: [], jam: 0 };
  state.shieldUsedBy = [];
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Losowanie kart razem z rolami (start gry). Karty dostają tylko prawdziwi gracze-obywatele. */
export function assignCards(state) {
  resetCardState(state);
  const cfg = cardConfig(state.settings);
  if (!cfg.advanced) return;

  const citizens = shuffled(
    Object.entries(state.roles || {})
      .filter(([id, role]) => role === 'citizen' && id !== state.hostId && !state.players?.get(id)?.isBot)
      .map(([id]) => id),
  );

  if (cfg.check) {
    for (let i = 0; i < cfg.checkCount && citizens.length; i++) {
      state.cards[citizens.shift()] = { type: 'check', used: false };
    }
  }
  if (cfg.shieldCitizen && citizens.length) {
    state.cards[citizens.shift()] = { type: 'shield', used: false };
  }

  if (cfg.shieldMafia || cfg.special !== 'none') {
    state.teamCards = {
      mafia: {
        shield: cfg.shieldMafia ? { used: false } : null,
        special: cfg.special !== 'none' ? { type: cfg.special, used: false } : null,
      },
    };
  }
}

/** Karty widoczne dla danego gracza (bez ujawniania cudzych). */
export function cardsFor(state, userId) {
  ensureCardState(state);
  const cfg = cardConfig(state.settings);
  const availableFromRound = Math.max(1, cfg.minRound);
  const own = state.cards[userId];
  if (own) {
    return [
      {
        type: own.type,
        team: 'town',
        used: own.used,
        queued: own.type === 'check' && state.cardQueue.check.includes(userId),
        nightCard: NIGHT_CARD_TYPES.has(own.type),
        availableFromRound: own.type === 'check' ? availableFromRound : 1,
      },
    ];
  }
  if (state.roles?.[userId] === 'mafia' && state.teamCards?.mafia) {
    const { shield, special } = state.teamCards.mafia;
    const out = [];
    if (shield) {
      out.push({ type: 'mafia_shield', team: 'mafia', used: shield.used, queued: false, nightCard: false, availableFromRound: 1 });
    }
    if (special) {
      out.push({
        type: special.type,
        team: 'mafia',
        used: special.used,
        queued: state.cardQueue.mafia?.type === special.type,
        nightCard: true,
        availableFromRound,
      });
    }
    return out;
  }
  return [];
}

/** Podgląd wszystkich kart dla mastera. */
export function cardsOverview(state) {
  ensureCardState(state);
  const holders = Object.entries(state.cards).map(([userId, c]) => ({
    userId,
    type: c.type,
    used: c.used,
  }));
  const mafia = state.teamCards?.mafia
    ? [
        state.teamCards.mafia.shield && { type: 'mafia_shield', used: state.teamCards.mafia.shield.used },
        state.teamCards.mafia.special && {
          type: state.teamCards.mafia.special.type,
          used: state.teamCards.mafia.special.used,
        },
      ].filter(Boolean)
    : [];
  return { holders, mafia };
}

export function currentCardActor(state) {
  return state.cardQueue?.check?.[state.nightTurn ?? 0] ?? null;
}

/** Co (ewentualnie) gracz ma teraz zrobić w turze karty — null, gdy nic. */
export function cardPromptFor(state, userId) {
  ensureCardState(state);
  if (state.phase === 'night_citizen_card') {
    const actor = currentCardActor(state);
    if (actor === userId && state.cards[userId]?.type === 'check' && !state.cardNight.checkDone?.[userId]) {
      return { type: 'check', targetCount: CHECK_GROUP_SIZE };
    }
  }
  if (state.phase === 'night_mafia_card') {
    const q = state.cardQueue.mafia;
    if (q && state.roles?.[userId] === 'mafia' && !state.cardNight.mafiaDone) {
      return { type: q.type };
    }
  }
  return null;
}

/** Dane karty mafii widoczne dla mafii (dziennik użyć + aktywne efekty). */
export function mafiaCardInfo(state) {
  ensureCardState(state);
  return {
    log: state.mafiaCardLog,
    wards: {
      alibi: [...state.cardEffects.alibi],
      falseLead: [...state.cardEffects.falseLead],
      jam: state.cardEffects.jam,
    },
  };
}

/** Kolejka kart dla mastera (kto zgłosił użycie). */
export function cardQueueFor(state) {
  ensureCardState(state);
  return {
    check: [...state.cardQueue.check],
    mafia: state.cardQueue.mafia ? state.cardQueue.mafia.type : null,
    // Zgłoszone tarcze (działają w bieżącym głosowaniu) — master też ogłasza ich użycie.
    shields: state.shieldUsedBy.length,
  };
}

export function emitCardQueue(io, state) {
  const masterInfo = state.players.get(state.hostId);
  if (masterInfo?.socketId) {
    io.to(masterInfo.socketId).emit('card_queue_update', cardQueueFor(state));
  }
}

async function isAliveUser(state, pb, id) {
  if (!state.players?.has(id)) return false;
  if (state.players.get(id)?.isBot) return !state.eliminatedBots?.has(id);
  const rp = await pb.collection('room_players').getList(1, 1, {
    filter: `room_id = "${state.id}" && user_id = "${id}"`,
    requestKey: null,
  });
  return rp.items.length > 0 && !rp.items[0].eliminated_at;
}

async function aliveParticipantIds(state, pb) {
  const ids = Object.keys(state.roles || {}).filter((id) => id !== state.hostId);
  const flags = await Promise.all(ids.map((id) => isAliveUser(state, pb, id)));
  return ids.filter((_, i) => flags[i]);
}

/**
 * Zgłoszenie użycia karty (przycisk „Użyj karty” w fazie głosowania).
 * Tarcza zadziała od razu; karty nocne trafiają do kolejki.
 */
export async function declareCard(io, state, pb, userId, type) {
  if (state.status !== 'in_progress') return { ok: false, error: 'game_not_started' };
  const cfg = cardConfig(state.settings);
  if (!cfg.advanced) return { ok: false, error: 'cards_disabled' };
  if (userId === state.hostId) return { ok: false, error: 'master_cannot_act' };
  if (state.phase !== 'day_vote') return { ok: false, error: 'wrong_phase' };
  if (!(await isAliveUser(state, pb, userId))) return { ok: false, error: 'eliminated' };
  ensureCardState(state);

  const role = state.roles?.[userId];
  let team;
  let card;
  if (type === 'check' || type === 'shield') {
    card = state.cards[userId];
    if (!card || card.type !== type) return { ok: false, error: 'no_card' };
    team = 'town';
  } else if (type === 'mafia_shield' || MAFIA_SPECIALS.includes(type)) {
    if (role !== 'mafia') return { ok: false, error: 'no_card' };
    const t = state.teamCards?.mafia;
    card = type === 'mafia_shield' ? t?.shield : t?.special?.type === type ? t.special : null;
    if (!card) return { ok: false, error: 'no_card' };
    team = 'mafia';
  } else {
    return { ok: false, error: 'unknown_card' };
  }
  if (card.used) return { ok: false, error: 'card_used' };

  if (NIGHT_CARD_TYPES.has(type)) {
    // Karta zadziała w nocy następnej rundy — wolno ją zgłosić, gdy ta noc nie jest przed `minRound`.
    if (state.round + 1 < cfg.minRound) {
      return { ok: false, error: 'too_early', availableFromRound: cfg.minRound };
    }
    const queued =
      type === 'check' ? state.cardQueue.check.includes(userId) : Boolean(state.cardQueue.mafia);
    if (queued) return { ok: false, error: 'already_queued' };
    if (type === 'check') state.cardQueue.check.push(userId);
    else state.cardQueue.mafia = { type, by: userId };
  } else {
    // Tarcza: zużywa się od razu i obowiązuje w tym głosowaniu.
    card.used = true;
    state.shieldUsedBy.push({ userId, team });
  }

  emitMasterInsight(io, state, { kind: 'card_declared', actorId: userId, cardType: type, team });
  emitCardQueue(io, state);
  return { ok: true, type, queued: NIGHT_CARD_TYPES.has(type) };
}

/** Wynik sprawdzenia z uwzględnieniem aktywnych efektów mafii (zużywa je). */
function evaluateCheck(state, targetIds) {
  const fx = state.cardEffects;
  const trueCount = targetIds.filter((id) => state.roles?.[id] === 'mafia').length;
  const hits = { alibi: [], falseLead: [] };

  if (fx.jam > 0) {
    fx.jam -= 1;
    const options = [];
    for (let i = 0; i <= targetIds.length; i++) if (i !== trueCount) options.push(i);
    return { trueCount, count: options[Math.floor(Math.random() * options.length)], jammed: true, hits };
  }

  let count = 0;
  for (const id of targetIds) {
    let isMafia = state.roles?.[id] === 'mafia';
    if (isMafia && fx.alibi.includes(id)) {
      isMafia = false;
      fx.alibi = fx.alibi.filter((x) => x !== id);
      hits.alibi.push(id);
    } else if (!isMafia && fx.falseLead.includes(id)) {
      isMafia = true;
      fx.falseLead = fx.falseLead.filter((x) => x !== id);
      hits.falseLead.push(id);
    }
    if (isMafia) count += 1;
  }
  return { trueCount, count, jammed: false, hits };
}

/**
 * Akcja nocna karty (event `card_night_action`):
 *  - faza `night_mafia_card`: dowolny żywy mafioso aktywuje zgłoszoną kartę mafii,
 *  - faza `night_citizen_card`: obywatel z kolejki wskazuje trójkę graczy do sprawdzenia.
 */
export async function performCardNightAction(io, state, pb, userId, data = {}) {
  if (state.status !== 'in_progress') return { ok: false, error: 'game_not_started' };
  if (userId === state.hostId) return { ok: false, error: 'master_cannot_act' };
  ensureCardState(state);

  if (state.phase === 'night_mafia_card') {
    const q = state.cardQueue.mafia;
    if (state.roles?.[userId] !== 'mafia') return { ok: false, error: 'not_mafia' };
    if (!q) return { ok: false, error: 'no_queued_card' };
    if (state.cardNight.mafiaDone) return { ok: false, error: 'already_acted' };
    if (!(await isAliveUser(state, pb, userId))) return { ok: false, error: 'eliminated' };

    let targetId = null;
    if (q.type === 'alibi') {
      const aliveMafia = await getAliveMafiaIds(state, pb);
      if (!aliveMafia.includes(data.targetId)) return { ok: false, error: 'invalid_target' };
      targetId = data.targetId;
      if (!state.cardEffects.alibi.includes(targetId)) state.cardEffects.alibi.push(targetId);
    } else if (q.type === 'false_lead') {
      const alive = await aliveParticipantIds(state, pb);
      if (!alive.includes(data.targetId) || state.roles?.[data.targetId] === 'mafia') {
        return { ok: false, error: 'invalid_target' };
      }
      targetId = data.targetId;
      if (!state.cardEffects.falseLead.includes(targetId)) state.cardEffects.falseLead.push(targetId);
    } else if (q.type === 'jam') {
      state.cardEffects.jam += 1;
    } else {
      return { ok: false, error: 'unknown_card' };
    }

    if (state.teamCards?.mafia?.special) state.teamCards.mafia.special.used = true;
    state.cardNight.mafiaDone = true;
    state.mafiaCardLog.push({ type: q.type, round: state.round, targetId });
    notifyMasterSubmission(io, state, 'mafia_card', { actorId: userId, cardType: q.type, targetId });
    emitMasterInsight(io, state, { kind: 'card_mafia', actorId: userId, cardType: q.type, targetId });
    return { ok: true, type: q.type, targetId };
  }

  if (state.phase === 'night_citizen_card') {
    if (currentCardActor(state) !== userId) return { ok: false, error: 'not_your_turn' };
    const card = state.cards[userId];
    if (!card || card.type !== 'check') return { ok: false, error: 'no_card' };
    if (card.used || state.cardNight.checkDone?.[userId]) return { ok: false, error: 'already_acted' };
    if (!(await isAliveUser(state, pb, userId))) return { ok: false, error: 'eliminated' };

    const targetIds = Array.isArray(data.targetIds) ? [...new Set(data.targetIds)] : [];
    const alive = (await aliveParticipantIds(state, pb)).filter((id) => id !== userId);
    const need = Math.min(CHECK_GROUP_SIZE, alive.length);
    if (need === 0 || targetIds.length !== need || !targetIds.every((id) => alive.includes(id))) {
      return { ok: false, error: 'invalid_targets', need };
    }

    const res = evaluateCheck(state, targetIds);
    card.used = true;
    state.cardNight.checkDone = { ...(state.cardNight.checkDone || {}), [userId]: true };
    (state.cardLog[userId] ||= []).push({ kind: 'check', round: state.round, targetIds, count: res.count });
    notifyMasterSubmission(io, state, 'citizen_card', {
      actorId: userId,
      targetIds,
      count: res.count,
      trueCount: res.trueCount,
      jammed: res.jammed,
    });
    emitMasterInsight(io, state, {
      kind: 'card_check',
      actorId: userId,
      targetIds,
      shownCount: res.count,
      trueCount: res.trueCount,
      jammed: res.jammed,
      alibiHits: res.hits.alibi,
      falseLeadHits: res.hits.falseLead,
    });
    return { ok: true, result: { count: res.count, total: targetIds.length, targetIds } };
  }

  return { ok: false, error: 'wrong_phase' };
}

/** Koniec nocy: nieużyte zgłoszenia wygasają, karty zostają „nieużyte” do kolejnego zgłoszenia. */
export function resetNightCards(state) {
  ensureCardState(state);
  state.cardQueue = { check: [], mafia: null };
  state.cardNight = {};
}

/** Po rozstrzygnięciu głosowania tarcze przestają obowiązywać. */
export function clearShields(state) {
  state.shieldUsedBy = [];
}
