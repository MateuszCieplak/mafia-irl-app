import { authenticateSocket } from './auth.js';
import { registerLobbyHandlers } from './lobby.js';
import { registerGameHandlers } from './game.js';
import { registerChatHandlers } from './chat.js';
import { registerPresenceHandlers } from './presence.js';
import { presenceRegister, presenceRemove } from '../game/presence.js';
import { rooms } from '../game/state.js';
import { buildRoomPlayerList } from '../game/roomPlayers.js';
import { scheduleLobbyRemoval } from '../game/lobbyGrace.js';

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
      // Telefon po wybudzeniu łączy się NOWYM socketem, zanim serwer zauważy
      // śmierć starego (heartbeat ~20–45 s). Rozłączenie starego socketu nie może
      // więc kasować obecności ani socketId nowego — inaczej gracz był widoczny
      // jako offline, nie dostawał eventów, a w lobby po karencji wylatywał
      // z pokoju, choć miał go otwartego na telefonie.
      presenceRemove(socket.userId, socket.id);

      const roomId = socket.roomId;
      const roomCode = socket.roomCode;
      if (roomId && roomCode) {
        const state = rooms.get(roomId);
        const p = state?.players.get(socket.userId);
        if (p && p.socketId === socket.id) {
          p.socketId = null;
          io.to(`room:${roomCode}`).emit('room_players_sync', {
            players: buildRoomPlayerList(state),
          });
          // Lobby: usuwamy gościa dopiero po okresie karencji.
          if (state.status === 'lobby' && socket.userId !== state.hostId) {
            scheduleLobbyRemoval(io, pb, state, socket.userId);
          }
        }
      }

      console.log(`[socket] disconnected: ${socket.userId} (${socket.id})`);
    });
  });
}
