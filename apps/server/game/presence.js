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

export function presenceRemove(userId) {
  presence.delete(userId);
}
