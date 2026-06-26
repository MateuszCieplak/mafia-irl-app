import {
  createRoom,
  joinPlayers,
  makePlayers,
  startGame,
  advancePhase,
} from './factory.js';
import { setAssignRolesForTest, clearAssignRolesForTest } from '../../game/roles.js';

/** Domyślny układ: p01 detektyw, p02 lekarz, p03–p04 mafia, p05–p10 obywatele. */
export function defaultRoleOrder() {
  return ['detective', 'doctor', 'mafia', 'mafia', ...Array(6).fill('citizen')];
}

export function roleMapFromParticipantOrder(ids) {
  const order = defaultRoleOrder();
  return Object.fromEntries(ids.map((id, i) => [id, order[i]]));
}

/**
 * Gra wystartowana, phase = null — pierwszy advance_phase przejdzie na night_detective (podpięcie listenerów przed pierwszym advance).
 */
export async function setupGameStartedBeforeFirstPhaseAdvance(ctxUrl, roomSettings = {}) {
  setAssignRolesForTest((ids) => roleMapFromParticipantOrder(ids));
  const { roomId, code, masterSocket } = await createRoom(ctxUrl, {
    min_players: 10,
    max_players: 15,
    doctor_can_self_protect: true,
    doctor_repeat_protect: false,
    self_vote: true,
    ...roomSettings,
  });
  const sockets = await joinPlayers(ctxUrl, code, makePlayers(10));
  await startGame(masterSocket);
  const socketById = Object.fromEntries(sockets.map((s) => [s.user.id, s]));
  return { roomId, code, masterSocket, sockets, socketById };
}

/**
 * Lobby + 10 graczy + start + pierwsza faza night_detective.
 * @returns {{ roomId, code, masterSocket, sockets: Array, socketById: Record<string, {socket,user}> }}
 */
export async function setupLobbyStartedWithPhaseDetective(ctxUrl, roomSettings = {}) {
  const base = await setupGameStartedBeforeFirstPhaseAdvance(ctxUrl, roomSettings);
  await advancePhase(base.masterSocket);
  return base;
}

/**
 * Gra w toku, faza night_doctor (detektyw już minął lub można pominąć — tu: po 2× advance od startu).
 */
export async function setupAtNightDoctor(ctxUrl, roomSettings = {}) {
  const ctx = await setupLobbyStartedWithPhaseDetective(ctxUrl, roomSettings);
  await advancePhase(ctx.masterSocket);
  return ctx;
}

/**
 * Faza night_mafia (po doktorze).
 */
export async function setupAtNightMafia(ctxUrl, roomSettings = {}) {
  const ctx = await setupAtNightDoctor(ctxUrl, roomSettings);
  await advancePhase(ctx.masterSocket);
  return ctx;
}

export { clearAssignRolesForTest };
