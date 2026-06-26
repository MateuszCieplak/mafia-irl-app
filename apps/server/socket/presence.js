import { presence, presenceList } from '../game/presence.js';
import { rooms } from '../game/state.js';

export function registerPresenceHandlers(io, socket) {
  socket.on('get_online_users', (_, callback) => {
    callback?.({ ok: true, users: presenceList(socket.userId) });
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

    io.to(target.socketId).emit('room_invite', {
      roomCode: socket.roomCode,
      fromUsername: socket.username,
      fromUserId: socket.userId,
    });

    callback?.({ ok: true });
  });
}
