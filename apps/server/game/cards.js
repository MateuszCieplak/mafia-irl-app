/**
 * Tryb „Mafia zaawansowana” — karty mocy.
 *
 * Każda karta jest jednorazowa. Drużyna ma bazowo najwyżej 2 karty (obywatele i mafia osobno).
 * Karty są losowane (z puli wybranej przez mastera) albo ustawione ręcznie.
 *
 * Karty INDYWIDUALNE (ma je konkretny gracz, `state.cards[userId]`):
 *  - `check`      (obywatel) Sprawdzenie: w nocy wskazuje 3 graczy i dostaje liczbę mafiozów w trójce.
 *  - `reveal`     (obywatel) Odkrycie: w nocy wskazuje gracza i poznaje jego rolę.
 *  - `shield`     (obywatel) Tarcza: jeśli z głosowania miałby odpaść OBYWATEL — zostaje w grze.
 *                 Ma ją jeden obywatel; po głosowaniu dowiaduje się, czy wyrzucony był obywatelem.
 *  - `alibi`      (mafia)    wybrany mafioso przy najbliższym Sprawdzeniu liczy się jako „czysty”.
 *  - `false_lead` (mafia)    wybrany niewinny przy najbliższym Sprawdzeniu liczy się jako mafia.
 *
 * Karty GLOBALNE (wspólne dla drużyny, `state.teamCards`):
 *  - `mafia_shield` (mafia)     Tarcza mafii: jeśli miałby odpaść MAFIOSO — zostaje w grze.
 *  - `jam`          (mafia)     najbliższe Sprawdzenie pokaże błędny wynik.
 *
 * Alibi / Fałszywy trop / Zakłócenie działają wyłącznie na kartę Sprawdzenia — detektyw zawsze
 * widzi prawdę.
 *
 * Użycie: gracz zgłasza kartę w fazie głosowania (`declareCard`). Tarcze działają od razu
 * (w tym głosowaniu). Karty nocne (Sprawdzenie, Alibi, Fałszywy trop, Zakłócenie) czekają w kolejce
 * na własną turę nocną (`night_mafia_card` → `night_citizen_card`, mafia zawsze pierwsza, żeby jej efekt
 * zdążył zadziałać na Sprawdzenie z tej samej nocy). Karty nocne można zgłosić dopiero od głosowania
 * rundy `card_min_round` (efekt w nocy następnej rundy).
 *
 * Nieużyta karta indywidualna wyeliminowanego gracza przechodzi na żywego gracza jego drużyny
 * (`transferCards`), żeby karty nie przepadały.
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

export const CITIZEN_CARD_TYPES = ['check', 'reveal', 'shield'];
export const MAFIA_CARD_TYPES = ['mafia_shield', 'alibi', 'false_lead', 'jam'];
export const MAFIA_SPECIALS = ['alibi', 'jam', 'false_lead'];
const NIGHT_CARD_TYPES = new Set(['check', 'reveal', 'alibi', 'false_lead', 'jam']);
const INDIVIDUAL_TYPES = new Set(['check', 'reveal', 'shield', 'alibi', 'false_lead']);
/** Karty obywatela z własną turą nocną (kolejka `cardQueue.check`). */
const CITIZEN_NIGHT_TYPES = new Set(['check', 'reveal']);
export const CHECK_GROUP_SIZE = 3;
export const MAX_CARDS_PER_TEAM = 2;

const TEAM_CARD_IDS = { mafia_shield: 'mafia_shield', jam: 'mafia_jam' };

/** Faza zapisywana w PocketBase (schemat nie zna faz kart) — karty mapujemy na `night_detective`. */
export function dbPhase(phase) {
  return CARD_PHASES.includes(phase) ? 'night_detective' : phase;
}

function sanitizeTypes(list, allowed, max) {
  if (!Array.isArray(list)) return [];
  return list.filter((t) => allowed.includes(t)).slice(0, max);
}

/** Normalizacja ustawień kart (współdzielona z lobby): domyślne wartości i przycięte zakresy. */
export function normalizeCardSettings(next) {
  next.advanced_mode = next.advanced_mode === true;
  next.card_min_round = Math.max(1, Math.floor(Number(next.card_min_round) || 3));
  next.card_assignment = next.card_assignment === 'manual' ? 'manual' : 'random';

  const clampCount = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(MAX_CARDS_PER_TEAM, Math.max(0, n)) : MAX_CARDS_PER_TEAM;
  };
  next.card_citizen_count = clampCount(next.card_citizen_count);
  next.card_mafia_count = clampCount(next.card_mafia_count);

  next.card_citizen_pool = Array.isArray(next.card_citizen_pool)
    ? sanitizeTypes(next.card_citizen_pool, CITIZEN_CARD_TYPES, CITIZEN_CARD_TYPES.length)
    : [...CITIZEN_CARD_TYPES];
  next.card_mafia_pool = Array.isArray(next.card_mafia_pool)
    ? sanitizeTypes(next.card_mafia_pool, MAFIA_CARD_TYPES, MAFIA_CARD_TYPES.length)
    : [...MAFIA_CARD_TYPES];
  next.card_citizen_manual = Array.isArray(next.card_citizen_manual)
    ? sanitizeTypes(next.card_citizen_manual, CITIZEN_CARD_TYPES, MAX_CARDS_PER_TEAM)
    : ['check', 'shield'];
  next.card_mafia_manual = Array.isArray(next.card_mafia_manual)
    ? sanitizeTypes(next.card_mafia_manual, MAFIA_CARD_TYPES, MAX_CARDS_PER_TEAM)
    : ['mafia_shield', 'alibi'];

  // Stare klucze (sprzed podziału na drużyny) nie mają już znaczenia.
  for (const k of [
    'card_check_enabled',
    'card_shield_citizen_enabled',
    'card_shield_mafia_enabled',
    'card_mafia_special',
    'check_card_count',
  ]) {
    delete next[k];
  }
  return next;
}

/** Znormalizowane ustawienia kart z `room.settings`. */
export function cardConfig(settings = {}) {
  const s = normalizeCardSettings({ ...(settings || {}) });
  return {
    advanced: s.advanced_mode,
    minRound: s.card_min_round,
    assignment: s.card_assignment,
    citizen: { count: s.card_citizen_count, pool: s.card_citizen_pool, manual: s.card_citizen_manual },
    mafia: { count: s.card_mafia_count, pool: s.card_mafia_pool, manual: s.card_mafia_manual },
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
  if (state?.cardQueue?.mafia?.length) extra.push('night_mafia_card');
  if (state?.cardQueue?.check?.length) extra.push('night_citizen_card');
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
  if (!state.cardQueue) state.cardQueue = { check: [], mafia: [] };
  if (!Array.isArray(state.cardQueue.mafia)) state.cardQueue.mafia = [];
  if (!state.cardNight) state.cardNight = {};
  if (!state.cardLog) state.cardLog = {};
  if (!state.mafiaCardLog) state.mafiaCardLog = [];
  if (!state.cardEffects) state.cardEffects = { alibi: [], falseLead: [], jam: 0 };
  if (!state.shieldUsedBy) state.shieldUsedBy = [];
  if (state.teamCards === undefined) state.teamCards = null;
  if (!state.cardSeq) state.cardSeq = 0;
  return state;
}

export function resetCardState(state) {
  state.cards = {};
  state.teamCards = null;
  state.cardQueue = { check: [], mafia: [] };
  state.cardNight = {};
  state.cardLog = {};
  state.mafiaCardLog = [];
  state.cardEffects = { alibi: [], falseLead: [], jam: 0 };
  state.shieldUsedBy = [];
  state.cardSeq = 0;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Które typy kart trafią do drużyny: ręczna lista mastera albo losowanie z puli. */
function chooseTypes(cfg, team) {
  const t = team === 'town' ? cfg.citizen : cfg.mafia;
  const allowed = team === 'town' ? CITIZEN_CARD_TYPES : MAFIA_CARD_TYPES;
  if (cfg.assignment === 'manual') {
    return t.manual.filter((x) => allowed.includes(x)).slice(0, MAX_CARDS_PER_TEAM);
  }
  const pool = t.pool.filter((x) => allowed.includes(x));
  return shuffled(pool).slice(0, Math.min(t.count, MAX_CARDS_PER_TEAM));
}

function newCard(state, type) {
  state.cardSeq += 1;
  return { id: `c${state.cardSeq}`, type, used: false };
}

/** Gracze, którzy mogą trzymać kartę indywidualną drużyny (prawdziwi, nie master, nie boty). */
function holderCandidates(state, team) {
  return Object.entries(state.roles || {})
    .filter(([id, role]) => {
      if (id === state.hostId || state.players?.get(id)?.isBot) return false;
      return team === 'mafia' ? role === 'mafia' : role !== 'mafia';
    })
    .map(([id]) => id);
}

/** Wybiera gracza z najmniejszą liczbą kart (przy remisie losowo), żeby karty się rozkładały. */
function leastLoaded(state, ids) {
  if (!ids.length) return null;
  const load = (id) => (state.cards[id] || []).length;
  const min = Math.min(...ids.map(load));
  const best = ids.filter((id) => load(id) === min);
  return best[Math.floor(Math.random() * best.length)];
}

/** Losowanie kart razem z rolami (start gry). */
export function assignCards(state) {
  resetCardState(state);
  const cfg = cardConfig(state.settings);
  if (!cfg.advanced) return;

  const teamCards = { town: {}, mafia: { shield: null, jam: null } };
  let anyTeam = false;

  for (const team of ['town', 'mafia']) {
    const holders = shuffled(holderCandidates(state, team));
    for (const type of chooseTypes(cfg, team)) {
      if (INDIVIDUAL_TYPES.has(type)) {
        const holder = leastLoaded(state, holders);
        if (!holder) continue;
        (state.cards[holder] ||= []).push(newCard(state, type));
      } else if (type === 'mafia_shield') {
        teamCards.mafia.shield = { id: TEAM_CARD_IDS.mafia_shield, type, used: false };
        anyTeam = true;
      } else if (type === 'jam') {
        teamCards.mafia.jam = { id: TEAM_CARD_IDS.jam, type, used: false };
        anyTeam = true;
      }
    }
  }
  state.teamCards = anyTeam ? teamCards : null;
}

function isTownRole(role) {
  return Boolean(role) && role !== 'mafia';
}

function teamOfRole(role) {
  return role === 'mafia' ? 'mafia' : 'town';
}

/** Karty globalne dostępne dla danej drużyny (lista obiektów kart). */
function teamCardsOf(state, team) {
  const t = state.teamCards;
  if (!t) return [];
  if (team === 'town') return []; // obywatele nie mają kart wspólnych — każda karta ma właściciela
  return [t.mafia?.shield, t.mafia?.jam].filter(Boolean);
}

/** Wszystkie karty widoczne dla gracza: własne indywidualne + globalne jego drużyny. */
function ownCardEntries(state, userId) {
  const role = state.roles?.[userId];
  const out = [];
  if (!role) return out;
  const team = teamOfRole(role);
  for (const card of state.cards[userId] || []) out.push({ card, team, global: false });
  for (const card of teamCardsOf(state, team)) out.push({ card, team, global: true });
  return out;
}

function isQueued(state, card) {
  return (
    state.cardQueue.check.some((e) => e.cardId === card.id) ||
    state.cardQueue.mafia.some((e) => e.cardId === card.id)
  );
}

/** Karty widoczne dla danego gracza (bez ujawniania cudzych). */
export function cardsFor(state, userId) {
  ensureCardState(state);
  const cfg = cardConfig(state.settings);
  return ownCardEntries(state, userId).map(({ card, team, global }) => ({
    id: card.id,
    type: card.type,
    team,
    scope: global ? 'global' : 'individual',
    used: card.used,
    queued: isQueued(state, card),
    nightCard: NIGHT_CARD_TYPES.has(card.type),
    // Karty nocne zgłasza się od głosowania tej rundy (efekt w nocy kolejnej).
    availableFromRound: NIGHT_CARD_TYPES.has(card.type) ? cfg.minRound : 1,
  }));
}

/** Podgląd wszystkich kart dla mastera. */
export function cardsOverview(state) {
  ensureCardState(state);
  const holders = [];
  for (const [userId, list] of Object.entries(state.cards)) {
    for (const c of list) {
      holders.push({ userId, type: c.type, used: c.used, team: CITIZEN_CARD_TYPES.includes(c.type) ? 'town' : 'mafia' });
    }
  }
  const team = [
    ...teamCardsOf(state, 'town').map((c) => ({ type: c.type, used: c.used, team: 'town' })),
    ...teamCardsOf(state, 'mafia').map((c) => ({ type: c.type, used: c.used, team: 'mafia' })),
  ];
  return { holders, team, mafia: team.filter((c) => c.team === 'mafia') };
}

export function currentCardActor(state) {
  return state.cardQueue?.check?.[state.nightTurn ?? 0]?.userId ?? null;
}

export function currentMafiaCardEntry(state) {
  return state.cardQueue?.mafia?.[state.nightTurn ?? 0] ?? null;
}

/** Co (ewentualnie) gracz ma teraz zrobić w turze karty — null, gdy nic. */
export function cardPromptFor(state, userId) {
  ensureCardState(state);
  if (state.phase === 'night_citizen_card') {
    const entry = state.cardQueue.check[state.nightTurn ?? 0];
    if (entry?.userId === userId && !state.cardNight.done?.[entry.cardId]) {
      if (entry.type === 'reveal') return { type: 'reveal', cardId: entry.cardId };
      return { type: 'check', cardId: entry.cardId, targetCount: CHECK_GROUP_SIZE };
    }
  }
  if (state.phase === 'night_mafia_card') {
    const entry = currentMafiaCardEntry(state);
    if (entry && entry.by === userId && !state.cardNight.done?.[entry.cardId]) {
      return { type: entry.type, cardId: entry.cardId };
    }
  }
  return null;
}

/** Dane kart mafii widoczne dla mafii (dziennik użyć + aktywne efekty). */
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
    check: state.cardQueue.check.map((e) => e.userId),
    mafia: state.cardQueue.mafia.map((e) => e.type),
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
 * `cardId` (opcjonalne) wskazuje konkretną kartę, gdy gracz ma kilka tego samego typu.
 */
export async function declareCard(io, state, pb, userId, type, cardId = null) {
  if (state.status !== 'in_progress') return { ok: false, error: 'game_not_started' };
  const cfg = cardConfig(state.settings);
  if (!cfg.advanced) return { ok: false, error: 'cards_disabled' };
  if (userId === state.hostId) return { ok: false, error: 'master_cannot_act' };
  if (state.phase !== 'day_vote') return { ok: false, error: 'wrong_phase' };
  if (!(await isAliveUser(state, pb, userId))) return { ok: false, error: 'eliminated' };
  ensureCardState(state);

  if (![...CITIZEN_CARD_TYPES, ...MAFIA_CARD_TYPES].includes(type)) {
    return { ok: false, error: 'unknown_card' };
  }

  // Karty gracza danego typu: najpierw wolna (nieużyta i niezgłoszona), inaczej pierwsza z brzegu.
  const matching = ownCardEntries(state, userId).filter(
    (e) => e.card.type === type && (!cardId || e.card.id === cardId),
  );
  if (!matching.length) return { ok: false, error: 'no_card' };
  const entry =
    matching.find((e) => !e.card.used && !isQueued(state, e.card)) ||
    matching.find((e) => !e.card.used) ||
    matching[0];
  const { card, team } = entry;
  if (card.used) return { ok: false, error: 'card_used' };

  if (NIGHT_CARD_TYPES.has(type)) {
    // Karta zadziała w nocy następnej rundy — wolno ją zgłosić od głosowania rundy `minRound`.
    if (state.round < cfg.minRound) {
      return { ok: false, error: 'too_early', availableFromRound: cfg.minRound };
    }
    if (isQueued(state, card)) return { ok: false, error: 'already_queued' };
    if (CITIZEN_NIGHT_TYPES.has(type)) {
      state.cardQueue.check.push({ userId, cardId: card.id, type });
    } else {
      state.cardQueue.mafia.push({ userId, by: userId, cardId: card.id, type });
    }
  } else {
    // Tarcza: zużywa się od razu i obowiązuje w tym głosowaniu (działa tylko na swoją drużynę).
    card.used = true;
    state.shieldUsedBy.push({ userId, team, cardId: card.id });
  }

  emitMasterInsight(io, state, { kind: 'card_declared', actorId: userId, cardType: type, team });
  emitCardQueue(io, state);
  return { ok: true, type, cardId: card.id, queued: NIGHT_CARD_TYPES.has(type) };
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

/** Znajduje kartę po id: indywidualną (u właściciela) albo globalną. */
function findCardById(state, cardId) {
  for (const list of Object.values(state.cards)) {
    const c = list.find((x) => x.id === cardId);
    if (c) return c;
  }
  for (const team of ['town', 'mafia']) {
    const c = teamCardsOf(state, team).find((x) => x.id === cardId);
    if (c) return c;
  }
  return null;
}

/**
 * Akcja nocna karty (event `card_night_action`):
 *  - faza `night_mafia_card`: mafioso, który zgłosił kartę (jej właściciel), aktywuje ją,
 *  - faza `night_citizen_card`: obywatel z kolejki wskazuje trójkę graczy do sprawdzenia.
 */
export async function performCardNightAction(io, state, pb, userId, data = {}) {
  if (state.status !== 'in_progress') return { ok: false, error: 'game_not_started' };
  if (userId === state.hostId) return { ok: false, error: 'master_cannot_act' };
  ensureCardState(state);
  if (!state.cardNight.done) state.cardNight.done = {};

  if (state.phase === 'night_mafia_card') {
    if (state.roles?.[userId] !== 'mafia') return { ok: false, error: 'not_mafia' };
    const q = currentMafiaCardEntry(state);
    if (!q) return { ok: false, error: 'no_queued_card' };
    if (q.by !== userId) return { ok: false, error: 'not_your_turn' };
    if (state.cardNight.done[q.cardId]) return { ok: false, error: 'already_acted' };
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

    const card = findCardById(state, q.cardId);
    if (card) card.used = true;
    state.cardNight.done[q.cardId] = true;
    state.mafiaCardLog.push({ type: q.type, round: state.round, targetId });
    notifyMasterSubmission(io, state, 'mafia_card', { actorId: userId, cardType: q.type, targetId });
    emitMasterInsight(io, state, { kind: 'card_mafia', actorId: userId, cardType: q.type, targetId });
    return { ok: true, type: q.type, targetId };
  }

  if (state.phase === 'night_citizen_card') {
    const entry = state.cardQueue.check[state.nightTurn ?? 0];
    if (!entry || entry.userId !== userId) return { ok: false, error: 'not_your_turn' };
    const card = (state.cards[userId] || []).find((c) => c.id === entry.cardId);
    if (!card || !CITIZEN_NIGHT_TYPES.has(card.type)) return { ok: false, error: 'no_card' };
    if (card.used || state.cardNight.done[entry.cardId]) return { ok: false, error: 'already_acted' };
    if (!(await isAliveUser(state, pb, userId))) return { ok: false, error: 'eliminated' };

    // Odkrycie: wskazany żywy gracz → obywatel poznaje jego dokładną rolę (karty mafii tego nie zakłócają).
    if (card.type === 'reveal') {
      const alive = (await aliveParticipantIds(state, pb)).filter((id) => id !== userId);
      if (!alive.includes(data.targetId)) return { ok: false, error: 'invalid_target' };
      const role = state.roles?.[data.targetId];
      card.used = true;
      state.cardNight.done[entry.cardId] = true;
      (state.cardLog[userId] ||= []).push({ kind: 'reveal', round: state.round, targetId: data.targetId, role });
      notifyMasterSubmission(io, state, 'citizen_card', {
        actorId: userId,
        cardType: 'reveal',
        targetId: data.targetId,
        role,
      });
      emitMasterInsight(io, state, { kind: 'card_reveal', actorId: userId, targetId: data.targetId, role });
      return { ok: true, result: { kind: 'reveal', targetId: data.targetId, role } };
    }

    const targetIds = Array.isArray(data.targetIds) ? [...new Set(data.targetIds)] : [];
    const alive = (await aliveParticipantIds(state, pb)).filter((id) => id !== userId);
    const need = Math.min(CHECK_GROUP_SIZE, alive.length);
    if (need === 0 || targetIds.length !== need || !targetIds.every((id) => alive.includes(id))) {
      return { ok: false, error: 'invalid_targets', need };
    }

    const res = evaluateCheck(state, targetIds);
    card.used = true;
    state.cardNight.done[entry.cardId] = true;
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
  state.cardQueue = { check: [], mafia: [] };
  state.cardNight = {};
}

/** Po rozstrzygnięciu głosowania tarcze przestają obowiązywać. */
export function clearShields(state) {
  state.shieldUsedBy = [];
}

/**
 * Rozliczenie tarcz po głosowaniu: każdy, kto użył tarczy, dostaje prywatną informację,
 * czy zadziałała — i kim był wskazany gracz (sygnał: obywatel / mafia).
 * `targetId` — gracz z największą liczbą głosów (null przy remisie / pominiętym głosowaniu),
 * `saved` — czy wyrzucenie zostało unieważnione.
 */
export function settleShields(io, state, { targetId, saved }) {
  ensureCardState(state);
  const targetTeam = targetId ? teamOfRole(state.roles?.[targetId]) : null;
  const reports = [];
  for (const s of state.shieldUsedBy) {
    const effective = Boolean(saved) && s.team === targetTeam;
    const entry = { kind: 'shield', round: state.round, targetId: targetId ?? null, saved: effective, targetTeam };
    (state.cardLog[s.userId] ||= []).push(entry);
    if (s.team === 'mafia') {
      state.mafiaCardLog.push({ type: 'mafia_shield', round: state.round, targetId: targetId ?? null, saved: effective });
    }
    const sock = state.players.get(s.userId)?.socketId;
    if (sock) io.to(sock).emit('card_shield_result', entry);
    reports.push({ userId: s.userId, team: s.team, saved: effective });
  }
  return reports;
}

/** Żywi gracze drużyny, którzy mogą przejąć kartę (prawdziwi, bez mastera i botów). */
async function aliveHeirs(state, pb, team, exceptId) {
  const ids = holderCandidates(state, team).filter((id) => id !== exceptId);
  const flags = await Promise.all(ids.map((id) => isAliveUser(state, pb, id)));
  return ids.filter((_, i) => flags[i]);
}

/**
 * Wyeliminowany gracz oddaje nieużyte karty indywidualne żywemu graczowi swojej drużyny
 * (razem ze zgłoszeniem w kolejce), a zgłoszona karta globalna (Zakłócenie) zmienia aktora.
 * Użyte karty zostają przy nim; jeśli nikt nie przeżył w drużynie, karta przepada.
 */
export async function transferCards(io, state, pb, deadId) {
  ensureCardState(state);
  const moved = [];
  const dead = state.roles?.[deadId];
  if (!dead) return moved;
  const team = teamOfRole(dead);

  const own = state.cards[deadId] || [];
  const unused = own.filter((c) => !c.used);
  if (unused.length) {
    const kept = own.filter((c) => c.used);
    if (kept.length) state.cards[deadId] = kept;
    else delete state.cards[deadId];

    for (const card of unused) {
      const heirs = await aliveHeirs(state, pb, team, deadId);
      const heir = leastLoaded(state, heirs);
      if (!heir) {
        moved.push({ cardId: card.id, type: card.type, from: deadId, to: null });
        continue;
      }
      (state.cards[heir] ||= []).push(card);
      for (const e of state.cardQueue.check) {
        if (e.cardId === card.id) e.userId = heir;
      }
      for (const e of state.cardQueue.mafia) {
        if (e.cardId === card.id) {
          e.userId = heir;
          e.by = heir;
        }
      }
      moved.push({ cardId: card.id, type: card.type, from: deadId, to: heir });
    }
  }

  // Zgłoszona karta globalna mafii (Zakłócenie): nowy aktor, jeśli zgłaszający odpadł.
  for (const e of state.cardQueue.mafia) {
    if (e.by !== deadId) continue;
    const heirs = await aliveHeirs(state, pb, 'mafia', deadId);
    const heir = leastLoaded(state, heirs);
    if (heir) {
      e.userId = heir;
      e.by = heir;
    }
  }

  const touched = new Set(moved.map((m) => m.to).filter(Boolean));
  for (const id of touched) {
    const sock = state.players.get(id)?.socketId;
    if (sock) io.to(sock).emit('cards_updated', { cards: cardsFor(state, id), received: moved.filter((m) => m.to === id) });
  }
  if (moved.length) emitMasterInsight(io, state, { kind: 'card_transferred', moved });
  emitCardQueue(io, state);
  return moved;
}
