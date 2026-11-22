/** userId -> { socketId, username, roomCode } — roomCode = kod pokoju lub null (lobby) */
export const presence = new Map();

export function presenceList(excludeUserId) {
  return Array.from(presence.entries())
    .filter(([id]) => id !== excludeUserId)
    .map(([id, v]) => ({
      id,
      username: v.username,
      inRoomCode: v.roomCode,
    }));
}

export function presenceRegister(socket) {
  presence.set(socket.userId, {
    socketId: socket.id,
    username: socket.username,
    roomCode: null,
  });
}

export function presenceUpdateSocket(userId, socketId) {
  const p = presence.get(userId);
  if (p) p.socketId = socketId;
}

export function presenceSetRoom(userId, roomCode) {
  const p = presence.get(userId);
  if (p) p.roomCode = roomCode || null;
}

export function presenceClearRoom(userId) {
  const p = presence.get(userId);
  if (p) p.roomCode = null;
}

/** Usuwa obecność tylko, gdy należy do rozłączanego socketu (nie do nowszego połączenia). */
export function presenceRemove(userId, socketId) {
  const p = presence.get(userId);
  if (!p) return;
  if (socketId && p.socketId !== socketId) return;
  presence.delete(userId);
}

/**
 * Zaproszenia oczekujące na gracza: userId -> Map(roomCode -> { roomCode, fromUsername, fromUserId, sentAt }).
 * Trzymane w pamięci serwera, więc przeżywają odświeżenie strony zaproszonego.
 */
export const pendingInvites = new Map();

export function addPendingInvite(userId, invite) {
  let byRoom = pendingInvites.get(userId);
  if (!byRoom) {
    byRoom = new Map();
    pendingInvites.set(userId, byRoom);
  }
  byRoom.set(invite.roomCode, invite);
}

export function removePendingInvite(userId, roomCode) {
  const byRoom = pendingInvites.get(userId);
  if (!byRoom) return;
  byRoom.delete(roomCode);
  if (byRoom.size === 0) pendingInvites.delete(userId);
}

export function getPendingInvites(userId) {
  return Array.from(pendingInvites.get(userId)?.values() ?? []);
}
