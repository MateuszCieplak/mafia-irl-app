import { io as ioClient } from 'socket.io-client';

export const USER_MASTER = { id: 'm0', username: 'Master', email: 'master@test.local' };

/** N graczy: id p1..pN (N<=99) — stabilne sortowanie alfabetyczne = kolejność numerów. */
export function makePlayers(count) {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const id = n < 10 ? `p0${n}` : `p${n}`;
    return { id, username: `Player_${n}`, email: `${id}@test.local` };
  });
}

export function emitAck(socket, event, data = {}) {
  return new Promise((resolve) => {
    socket.emit(event, data, (res) => resolve(res ?? { ok: false, error: 'no_callback' }));
  });
}

export function connectTestClient(url, testUser) {
  const socket = ioClient(url, {
    transports: ['websocket'],
    auth: { testUser },
    reconnection: false,
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.once('connect', () => {
      clearTimeout(t);
      resolve(socket);
    });
    socket.once('connect_error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

export async function disconnectSocket(socket) {
  if (!socket?.connected) return;
  socket.disconnect();
  await new Promise((r) => setTimeout(r, 50));
}

/**
 * @returns {{ roomId: string, code: string, masterSocket: import('socket.io-client').Socket }}
 */
export async function createRoom(url, settings = {}) {
  const masterSocket = await connectTestClient(url, USER_MASTER);
  const defaults = {
    min_players: 4,
    max_players: 15,
    doctor_can_self_protect: true,
    doctor_repeat_protect: false,
    self_vote: true,
  };
  const res = await emitAck(masterSocket, 'create_room', {
    settings: { ...defaults, ...settings },
  });
  if (!res.ok) throw new Error(`create_room: ${res.error}`);
  return { roomId: res.roomId, code: res.code, masterSocket };
}

/**
 * @returns {Array<{ socket: import('socket.io-client').Socket, user: object }>}
 */
export async function joinPlayers(url, code, users) {
  const out = [];
  for (const user of users) {
    const socket = await connectTestClient(url, user);
    const res = await emitAck(socket, 'join_room', { code });
    if (!res.ok) throw new Error(`join_room ${user.id}: ${res.error}`);
    out.push({ socket, user });
  }
  return out;
}

export async function advancePhase(masterSocket) {
  return emitAck(masterSocket, 'advance_phase');
}

/** Przechodzi fazę po fazie aż do `targetPhase` (włącznie). */
export async function advanceUntilPhase(masterSocket, targetPhase, maxSteps = 40) {
  let last;
  for (let i = 0; i < maxSteps; i++) {
    last = await advancePhase(masterSocket);
    if (!last.ok) return last;
    if (last.phase === targetPhase) return last;
  }
  throw new Error(`advanceUntilPhase: nie osiągnięto ${targetPhase}, ostatnia: ${last?.phase}`);
}

export async function startGame(masterSocket) {
  return emitAck(masterSocket, 'start_game');
}

export async function submitNightAction(playerSocket, targetId) {
  return emitAck(playerSocket, 'night_action', { targetId });
}

export async function submitVote(playerSocket, targetId) {
  return emitAck(playerSocket, 'vote', { targetId: targetId ?? null });
}

export async function getGameState(socket) {
  return emitAck(socket, 'get_game_state');
}

/** Od aktualnej fazy (np. night_detective po akcji) do night_detective następnej rundy — 7× advance_phase. */
export async function advanceCycleToNextNightDetective(masterSocket) {
  for (let i = 0; i < 7; i++) {
    const r = await advancePhase(masterSocket);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * Pełna noc od night_detective: opcjonalnie det → lekarz → mafia (konsensus) → rozwiązanie → day_deliberation.
 */
export async function playFullNightFromDetective(masterSocket, socketById, targets) {
  if (targets.det) {
    const a = await submitNightAction(socketById.p01.socket, targets.det);
    if (!a.ok) return a;
  }
  let r = await advancePhase(masterSocket);
  if (!r.ok) return r;

  if (targets.doc) {
    const d = await submitNightAction(socketById.p02.socket, targets.doc);
    if (!d.ok) return d;
  }
  r = await advancePhase(masterSocket);
  if (!r.ok) return r;

  if (targets.kill) {
    const k1 = await submitNightAction(socketById.p03.socket, targets.kill);
    if (!k1.ok) return k1;
    const k2 = await submitNightAction(socketById.p04.socket, targets.kill);
    if (!k2.ok) return k2;
  }

  r = await advancePhase(masterSocket);
  if (!r.ok) return r;
  r = await advancePhase(masterSocket);
  return r;
}

/**
 * Po day_deliberation: głosowanie + rozstrzygnięcie dnia → night_detective następnej rundy.
 * Serwer: day_vote → (1× advance) → day_resolve → (2× advance) → resolveVotes + nowa runda nd.
 */
export async function playDayDeliberationAndVoteResolve(masterSocket, voteFn) {
  let r = await advancePhase(masterSocket);
  if (!r.ok) return r;
  await voteFn();
  r = await advancePhase(masterSocket);
  if (!r.ok) return r;
  if (r.phase === 'day_resolve') {
    r = await advancePhase(masterSocket);
  }
  return r;
}

export async function allPlayersSkipVote(sockets) {
  for (const { socket } of sockets) {
    const v = await submitVote(socket, null);
    if (!v.ok) return v;
  }
  return { ok: true };
}

/** Skip tylko dla graczy bez eliminated_at (mock PocketBase). */
export async function allLivingPlayersSkipVote(sockets, pb, roomId) {
  for (const { socket, user } of sockets) {
    const rp = await pb.collection('room_players').getList(1, 1, {
      filter: `room_id = "${roomId}" && user_id = "${user.id}"`,
    });
    if (rp.items[0]?.eliminated_at) continue;
    const v = await submitVote(socket, null);
    if (!v.ok) return v;
  }
  return { ok: true };
}

export async function chatMessage(socket, channel, body) {
  return emitAck(socket, 'chat_message', { channel, body });
}
