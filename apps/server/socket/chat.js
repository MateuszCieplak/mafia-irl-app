import { rooms } from '../game/state.js';
import { displayNameFromUserRecord } from '../lib/userDisplayName.js';

function usernameFromExpand(exp) {
  return displayNameFromUserRecord(exp);
}

export function registerChatHandlers(io, socket, pb) {
  socket.on('load_chat_messages', async (data, callback) => {
    const { channel } = data || {};
    if (!channel) {
      return callback?.({ ok: false, error: 'missing_channel' });
    }

    const state = rooms.get(socket.roomId);
    if (!state) {
      return callback?.({ ok: false, error: 'no_room' });
    }

    const player = state.players.get(socket.userId);
    if (!player) {
      return callback?.({ ok: false, error: 'not_in_room' });
    }

    if (channel === 'day') {
      return callback?.({ ok: false, error: 'channel_disabled' });
    }

    if (channel === 'mafia_night') {
      if (state.phase !== 'night_mafia') {
        return callback?.({ ok: false, error: 'wrong_phase' });
      }
      const rp = await pb.collection('room_players').getList(1, 1, {
        filter: `room_id = "${state.id}" && user_id = "${socket.userId}"`,
        requestKey: null,
      });
      if (rp.items.length === 0 || rp.items[0].role !== 'mafia') {
        return callback?.({ ok: false, error: 'forbidden' });
      }
    }

    try {
      const list = await pb.collection('messages').getFullList({
        filter: `room_id = "${state.id}" && channel = "${channel}"`,
        sort: '+created',
        expand: 'user_id',
        requestKey: null,
      });

      const messages = list.map((m) => ({
        id: m.id,
        userId: m.user_id,
        username: usernameFromExpand(m.expand?.user_id),
        channel: m.channel,
        body: m.body,
        created_at: m.created,
      }));

      callback?.({ ok: true, messages });
    } catch (err) {
      console.error('[chat] load_chat_messages:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('chat_message', async (data, callback) => {
    const ack = (payload = { ok: true }) => callback?.(payload);

    const { channel, body } = data;
    const state = rooms.get(socket.roomId);
    if (!state) return ack({ ok: false, error: 'no_room' });
    if (channel !== 'lobby' && state.status === 'finished') {
      return ack({ ok: false, error: 'game_finished' });
    }

    const player = state.players.get(socket.userId);
    if (!player) return ack({ ok: false, error: 'not_in_room' });

    if (channel === 'mafia_night') {
      const rp = await pb.collection('room_players').getList(1, 1, {
        filter: `room_id = "${state.id}" && user_id = "${socket.userId}"`,
        requestKey: null,
      });
      if (rp.items.length === 0 || rp.items[0].role !== 'mafia') {
        return ack({ ok: false, error: 'forbidden' });
      }
    }

    if (channel === 'day') {
      return ack({ ok: false, error: 'channel_disabled' });
    }

    if (channel === 'mafia_night') {
      if (state.phase !== 'night_mafia') {
        return ack({ ok: false, error: 'wrong_phase' });
      }
    }

    const message = await pb.collection('messages').create({
      room_id: state.id,
      user_id: socket.userId,
      channel,
      body,
    });

    const payload = {
      id: message.id,
      userId: socket.userId,
      username: socket.username,
      channel,
      body,
      created_at: message.created,
    };

    if (channel === 'mafia_night') {
      const mafiaPlayers = await pb.collection('room_players').getFullList({
        filter: `room_id = "${state.id}" && role = "mafia"`,
        requestKey: null,
      });
      for (const mp of mafiaPlayers) {
        const pInfo = state.players.get(mp.user_id);
        if (pInfo) {
          io.to(pInfo.socketId).emit('chat_message', payload);
        }
      }
    } else {
      io.to(`room:${state.code}`).emit('chat_message', payload);
    }

    ack({ ok: true });
  });
}
