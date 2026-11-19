import {
  presence,
  presenceList,
  addPendingInvite,
  removePendingInvite,
  getPendingInvites,
} from '../game/presence.js';
import { rooms } from '../game/state.js';

/** Zapisuje zaproszenie (pamięć pokoju + kolejka gracza) i wysyła je, gdy gracz jest online. */
function deliverInvite(io, socket, state, targetUserId) {
  const invite = {
    roomCode: socket.roomCode,
    fromUsername: socket.username,
    fromUserId: socket.userId,
    sentAt: Date.now(),
  };
  if (!state.invites) state.invites = new Map();
  state.invites.set(targetUserId, invite.sentAt);
  addPendingInvite(targetUserId, invite);

  const target = presence.get(targetUserId);
  if (target) io.to(target.socketId).emit('room_invite', invite);
}

export function registerPresenceHandlers(io, socket) {
  socket.on('get_online_users', (_, callback) => {
    const state = socket.roomId ? rooms.get(socket.roomId) : null;
    const isHost = Boolean(state && socket.userId === state.hostId);
    const users = presenceList(socket.userId).map((u) => ({
      ...u,
      ...(isHost && state.invites?.has(u.id) ? { invited: true } : {}),
    }));
    callback?.({ ok: true, users });
  });

  // Po odświeżeniu strony / ponownym połączeniu gracz odzyskuje swoje zaproszenia.
  socket.on('get_my_invites', (_, callback) => {
    const live = getPendingInvites(socket.userId).filter((inv) => {
      const state = Array.from(rooms.values()).find((r) => r.code === inv.roomCode);
      if (!state || state.status !== 'lobby' || state.players.has(socket.userId)) {
        removePendingInvite(socket.userId, inv.roomCode);
        return false;
      }
      return true;
    });
    callback?.({ ok: true, invites: live });
  });

  // Gracz odrzucił zaproszenie — host może zaprosić go ponownie.
  socket.on('decline_invite', (data, callback) => {
    const { roomCode } = data || {};
    if (!roomCode) return callback?.({ ok: false, error: 'missing_room' });
    removePendingInvite(socket.userId, roomCode);
    const state = Array.from(rooms.values()).find((r) => r.code === roomCode);
    state?.invites?.delete(socket.userId);
    callback?.({ ok: true });
  });

  socket.on('invite_to_room', (data, callback) => {
    const { targetUserId } = data || {};
    if (!targetUserId) {
      return callback?.({ ok: false, error: 'missing_target' });
    }
    if (!socket.roomCode) {
      return callback?.({ ok: false, error: 'not_in_room' });
    }

    const state = rooms.get(socket.roomId);
    if (!state || socket.userId !== state.hostId) {
      return callback?.({ ok: false, error: 'not_master' });
    }

    const target = presence.get(targetUserId);
    if (!target) {
      return callback?.({ ok: false, error: 'user_offline' });
    }
    if (targetUserId === socket.userId) {
      return callback?.({ ok: false, error: 'invalid_target' });
    }

    deliverInvite(io, socket, state, targetUserId);
    callback?.({ ok: true });
  });

  // „Wyślij zaproszenia do wszystkich”: tylko gracze online, spoza pokoju i bez wysłanego zaproszenia.
  socket.on('invite_all', (_, callback) => {
    if (!socket.roomCode) return callback?.({ ok: false, error: 'not_in_room' });
    const state = rooms.get(socket.roomId);
    if (!state || socket.userId !== state.hostId) {
      return callback?.({ ok: false, error: 'not_master' });
    }

    const invitedNow = [];
    for (const u of presenceList(socket.userId)) {
      if (state.players.has(u.id)) continue;
      if (u.inRoomCode === socket.roomCode) continue;
      if (state.invites?.has(u.id)) continue;
      deliverInvite(io, socket, state, u.id);
      invitedNow.push(u.id);
    }
    callback?.({ ok: true, sent: invitedNow.length, userIds: invitedNow });
  });
}
