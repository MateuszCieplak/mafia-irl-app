import { authenticateSocket } from './auth.js';
import { registerLobbyHandlers } from './lobby.js';
import { registerGameHandlers } from './game.js';
import { registerChatHandlers } from './chat.js';
import { registerPresenceHandlers } from './presence.js';
import { presenceRegister, presenceRemove } from '../game/presence.js';
import { rooms } from '../game/state.js';
import { buildRoomPlayerList } from '../game/roomPlayers.js';

function ensureDisconnectTimers(state) {
  if (!state.disconnectTimers) state.disconnectTimers = new Map(); // userId -> Timeout
  return state.disconnectTimers;
}

function clearDisconnectTimer(state, userId) {
  const timers = state?.disconnectTimers;
  const t = timers?.get(userId);
  if (t) clearTimeout(t);
  timers?.delete(userId);
}

export function registerSocketHandlers(io, pb) {
  io.use((socket, next) => authenticateSocket(socket, next, pb));

  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.userId} (${socket.id})`);

    presenceRegister(socket);

    registerLobbyHandlers(io, socket, pb);
    registerGameHandlers(io, socket, pb);
    registerChatHandlers(io, socket, pb);
    registerPresenceHandlers(io, socket);

    socket.on('disconnect', async () => {
      presenceRemove(socket.userId);

      const roomId = socket.roomId;
      const roomCode = socket.roomCode;
      if (roomId && roomCode) {
        const state = rooms.get(roomId);
        if (state?.players.has(socket.userId)) {
          if (state.status === 'lobby' && socket.userId !== state.hostId) {
            // Lobby guest: mark offline now, and remove only after grace period
            // (mobile screen lock / tab minimize may temporarily drop the socket).
            const p = state.players.get(socket.userId);
            if (p) p.socketId = null;
            io.to(`room:${roomCode}`).emit('room_players_sync', {
              players: buildRoomPlayerList(state),
            });

            clearDisconnectTimer(state, socket.userId);
            const settings = state.settings || {};
            const graceMs =
              typeof settings.lobby_disconnect_grace_ms === 'number'
                ? settings.lobby_disconnect_grace_ms
                : 120000;
            const timers = ensureDisconnectTimers(state);
            timers.set(
              socket.userId,
              setTimeout(async () => {
                try {
                  const st = rooms.get(roomId);
                  if (!st) return;
                  if (st.status !== 'lobby') return;
                  const cur = st.players.get(socket.userId);
                  // If user reconnected, socketId will be set again.
                  if (cur?.socketId) return;
                  st.players.delete(socket.userId);

                  try {
                    const rp = await pb.collection('room_players').getList(1, 1, {
                      filter: `room_id = "${st.id}" && user_id = "${socket.userId}"`,
                      requestKey: null,
                    });
                    if (rp.items[0]) await pb.collection('room_players').delete(rp.items[0].id);
                  } catch (err) {
                    console.error('[socket] lobby disconnect cleanup (grace):', err.message);
                  }

                  io.to(`room:${roomCode}`).emit('player_left', { userId: socket.userId });
                } finally {
                  const st = rooms.get(roomId);
                  clearDisconnectTimer(st, socket.userId);
                }
              }, graceMs)
            );
          } else {
            const p = state.players.get(socket.userId);
            if (p) p.socketId = null;
            io.to(`room:${roomCode}`).emit('room_players_sync', {
              players: buildRoomPlayerList(state),
            });
          }
        }
      }

      console.log(`[socket] disconnected: ${socket.userId}`);
    });
  });
}
