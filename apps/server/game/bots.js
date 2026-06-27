import { randomUUID } from 'crypto';
import { processNightAction, processVote } from './actions.js';
import { buildRoomPlayerList } from './roomPlayers.js';
import { tryAutoAdvance } from './phaseFlow.js';

const BOT_DELAY_MIN_MS = 500;
const BOT_DELAY_MAX_MS = 1500;
const BOT_DELAY_TEST_MIN_MS = 0;
const BOT_DELAY_TEST_MAX_MS = 25;

function pickDelay() {
  if (process.env.MAFIA_TEST_AUTH === '1') {
    return BOT_DELAY_TEST_MIN_MS + Math.floor(Math.random() * (BOT_DELAY_TEST_MAX_MS - BOT_DELAY_TEST_MIN_MS));
  }
  return BOT_DELAY_MIN_MS + Math.floor(Math.random() * (BOT_DELAY_MAX_MS - BOT_DELAY_MIN_MS));
}

function botCountForState(state) {
  let n = 0;
  for (const p of state.players.values()) if (p.isBot) n += 1;
  return n;
}

/** Sprawdza, czy bot jest żywy (in-memory, bez PB). */
export function isBotAlive(state, botId) {
  return state.players.has(botId) && !state.eliminatedBots?.has(botId);
}

/** Oznacza bota jako wyeliminowanego (in-memory, bez PB). */
export function eliminateBot(state, botId) {
  if (!state.eliminatedBots) state.eliminatedBots = new Set();
  state.eliminatedBots.add(botId);
}

/**
 * Buduje zbiór wyeliminowanych user_id ze wszystkich źródeł:
 * - room_players w PB (prawdziwi gracze),
 * - state.eliminatedBots (boty).
 */
export async function buildEliminatedSet(state, pb) {
  const rps = await pb.collection('room_players').getFullList({
    filter: `room_id = "${state.id}"`,
  });
  const set = new Set();
  for (const r of rps) if (r.eliminated_at) set.add(r.user_id);
  if (state.eliminatedBots) {
    for (const botId of state.eliminatedBots) set.add(botId);
  }
  return set;
}

function alivePlayerIdsFromState(state, eliminatedSet) {
  const out = [];
  for (const id of state.players.keys()) {
    if (id === state.hostId) continue;
    if (eliminatedSet.has(id)) continue;
    out.push(id);
  }
  out.sort();
  return out;
}

/**
 * Dodaje bota do pokoju (lobby). Bot istnieje WYŁĄCZNIE w state.players — żadnych
 * rekordów PocketBase (ani users, ani room_players). Unika to błędów FK oraz
 * zanieczyszczenia bazy prawdziwymi kontami.
 */
export async function addBotToRoom(io, state) {
  const displayNumber = botCountForState(state) + 1;
  const botId = `bot_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const displayName = `Bot ${displayNumber}`;

  if (!state.eliminatedBots) state.eliminatedBots = new Set();

  state.players.set(botId, {
    socketId: `bot:${botId}`,
    username: displayName,
    isBot: true,
  });

  io.to(`room:${state.code}`).emit('player_joined', {
    userId: botId,
    username: displayName,
    isBot: true,
    players: buildRoomPlayerList(state),
  });

  return { id: botId, username: displayName };
}

// --- Heurystyki wyboru celu ---

function pickDetectiveTarget(state, botId, aliveIds) {
  const memory = state.botMemory || {};
  const detectiveResults = memory.detectiveResults || new Map();
  const candidates = aliveIds.filter(
    (id) => id !== botId && !detectiveResults.has(id)
  );
  const pool = candidates.length > 0 ? candidates : aliveIds.filter((id) => id !== botId);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickDoctorTarget(state, botId, aliveIds) {
  const settings = state.settings || {};
  const memory = state.botMemory || {};
  const confirmedTownIds = memory.confirmedTownIds || new Set();

  let pool = aliveIds.filter((id) => id !== botId);
  if (settings.doctor_can_self_protect !== false) pool = aliveIds.slice();
  if (settings.doctor_repeat_protect === false && state.previousDoctorProtectTarget) {
    pool = pool.filter((id) => id !== state.previousDoctorProtectTarget);
  }
  if (pool.length === 0) return null;

  const known = pool.filter((id) => confirmedTownIds.has(id));
  const candidates = known.length > 0 ? known : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function pickMafiaTarget(state, aliveIds) {
  const mafiaIds = new Set(
    Object.entries(state.roles || {})
      .filter(([, r]) => r === 'mafia')
      .map(([uid]) => uid)
  );

  const nonMafiaAlive = aliveIds.filter((id) => !mafiaIds.has(id));
  if (nonMafiaAlive.length === 0) return null;

  const priorityIds = [
    ...nonMafiaAlive.filter((id) => state.roles?.[id] === 'detective'),
    ...nonMafiaAlive.filter((id) => state.roles?.[id] === 'doctor'),
  ];
  if (priorityIds.length > 0) {
    priorityIds.sort();
    return priorityIds[0];
  }

  const sorted = [...nonMafiaAlive].sort();
  return sorted[0];
}

function pickVoteTarget(state, voterId, aliveIds) {
  const memory = state.botMemory || {};
  const confirmedMafiaIds = memory.confirmedMafiaIds || new Set();
  const voterRole = state.roles?.[voterId];

  if (voterRole === 'mafia') {
    const nonMafiaAlive = aliveIds.filter(
      (id) => id !== voterId && state.roles?.[id] !== 'mafia'
    );
    if (nonMafiaAlive.length === 0) return null;
    const detectives = nonMafiaAlive.filter((id) => state.roles?.[id] === 'detective');
    if (detectives.length > 0) return [...detectives].sort()[0];
    return [...nonMafiaAlive].sort()[0];
  }

  const knownMafia = aliveIds.filter(
    (id) => id !== voterId && confirmedMafiaIds.has(id)
  );
  if (knownMafia.length > 0) return [...knownMafia].sort()[0];

  return null;
}

function recordDetectiveResult(state, targetId, isMafia) {
  if (!state.botMemory) {
    state.botMemory = {
      detectiveResults: new Map(),
      confirmedMafiaIds: new Set(),
      confirmedTownIds: new Set(),
    };
  }
  state.botMemory.detectiveResults.set(targetId, isMafia);
  if (isMafia) state.botMemory.confirmedMafiaIds.add(targetId);
  else state.botMemory.confirmedTownIds.add(targetId);
}

// --- Akcje nocne botów ---

async function runBotDetective(io, state, pb, botId) {
  if (state.phase !== 'night_detective') return;
  if (state.nightActions.detective) return;
  if (!isBotAlive(state, botId)) return;

  const eliminated = await buildEliminatedSet(state, pb);
  const aliveIds = alivePlayerIdsFromState(state, eliminated);
  const targetId = pickDetectiveTarget(state, botId, aliveIds);
  if (!targetId) return;

  const res = await processNightAction(io, state, pb, botId, targetId);
  if (res?.ok && res.result) {
    recordDetectiveResult(state, targetId, res.result.is_mafia);
  }
  if (res?.ok) await tryAutoAdvance(io, state, pb);
}

async function runBotDoctor(io, state, pb, botId) {
  if (state.phase !== 'night_doctor') return;
  if (state.nightActions.doctor) return;
  if (!isBotAlive(state, botId)) return;

  const eliminated = await buildEliminatedSet(state, pb);
  const aliveIds = alivePlayerIdsFromState(state, eliminated);
  const targetId = pickDoctorTarget(state, botId, aliveIds);
  if (!targetId) return;

  await processNightAction(io, state, pb, botId, targetId);
  await tryAutoAdvance(io, state, pb);
}

async function runBotMafia(io, state, pb, botId) {
  if (state.phase !== 'night_mafia') return;
  if (state.mafiaTargets.has(botId)) return;
  if (!isBotAlive(state, botId)) return;

  const eliminated = await buildEliminatedSet(state, pb);
  const aliveIds = alivePlayerIdsFromState(state, eliminated);
  const targetId = pickMafiaTarget(state, aliveIds);
  if (!targetId) return;

  await processNightAction(io, state, pb, botId, targetId);
  await tryAutoAdvance(io, state, pb);
}

async function runBotVote(io, state, pb, botId) {
  if (state.phase !== 'day_vote') return;
  if (state.votes.has(botId)) return;
  if (!isBotAlive(state, botId)) return;

  const eliminated = await buildEliminatedSet(state, pb);
  const aliveIds = alivePlayerIdsFromState(state, eliminated);
  const targetId = pickVoteTarget(state, botId, aliveIds);

  await processVote(io, state, pb, botId, targetId);
  await tryAutoAdvance(io, state, pb);
}

/**
 * Główne API dla socket/game.js — po każdym phase_changed planuje wywołanie akcji
 * dla każdego bota, którego rola jest aktywna w nowej fazie.
 */
export function scheduleBotPhaseActions(io, state, pb, phase) {
  if (!state || state.status !== 'in_progress') return;
  if (!state.players) return;

  const roleForPhase = {
    night_detective: 'detective',
    night_doctor: 'doctor',
    night_mafia: 'mafia',
  };

  for (const [botId, info] of state.players.entries()) {
    if (!info.isBot) continue;

    if (phase === 'day_vote') {
      const delay = pickDelay();
      setTimeout(() => {
        runBotVote(io, state, pb, botId).catch((err) => {
          console.error('[bots] runBotVote error:', err.message);
        });
      }, delay);
      continue;
    }

    const expectedRole = roleForPhase[phase];
    if (!expectedRole) continue;
    if (state.roles?.[botId] !== expectedRole) continue;

    const delay = pickDelay();
    setTimeout(() => {
      const fn =
        expectedRole === 'detective' ? runBotDetective :
        expectedRole === 'doctor' ? runBotDoctor :
        runBotMafia;
      fn(io, state, pb, botId).catch((err) => {
        console.error(`[bots] runBot ${expectedRole} error:`, err.message);
      });
    }, delay);
  }
}
