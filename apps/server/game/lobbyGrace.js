import { rooms } from './state.js';

/**
 * Usuwanie gracza z lobby po okresie karencji. Telefon z wygaszonym ekranem
 * albo zamknięty Chrome zrywa socket — gracz dostaje chwilę na powrót, a gdy
 * nie wróci, znika z pokoju (inaczej wisiałby jako „offline” i blokował start).
 */
export function ensureDisconnectTimers(state) {
  if (!state.disconnectTimers) state.disconnectTimers = new Map(); // userId -> Timeout
  return state.disconnectTimers;
}

export function clearDisconnectTimer(state, userId) {
  const timers = state?.disconnectTimers;
  const t = timers?.get(userId);
  if (t) clearTimeout(t);
  timers?.delete(userId);
}

export function lobbyGraceMs(state) {
  const ms = state?.settings?.lobby_disconnect_grace_ms;
  return typeof ms === 'number' && ms >= 0 ? ms : 120000;
}

export function scheduleLobbyRemoval(io, pb, state, userId) {
  if (!state || userId === state.hostId) return;
  clearDisconnectTimer(state, userId);
  const roomId = state.id;
  const roomCode = state.code;
  ensureDisconnectTimers(state).set(
    userId,
    setTimeout(async () => {
      try {
        const st = rooms.get(roomId);
        if (!st || st.status !== 'lobby') return;
        const cur = st.players.get(userId);
        // Gracz wrócił (nowy socket) — zostaje w pokoju.
        if (!cur || cur.socketId || cur.isBot) return;
        st.players.delete(userId);

        try {
          const rp = await pb.collection('room_players').getList(1, 1, {
            filter: `room_id = "${roomId}" && user_id = "${userId}"`,
            requestKey: null,
          });
          if (rp.items[0]) await pb.collection('room_players').delete(rp.items[0].id);
        } catch (err) {
          console.error('[lobby] disconnect cleanup (grace):', err.message);
        }

        io.to(`room:${roomCode}`).emit('player_left', { userId });
      } finally {
        clearDisconnectTimer(rooms.get(roomId), userId);
      }
    }, lobbyGraceMs(state)),
  );
}
