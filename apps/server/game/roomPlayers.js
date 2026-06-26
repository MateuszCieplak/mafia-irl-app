/** Buduje listę graczy wysyłaną do klienta (lobby / sync). */
export function buildRoomPlayerList(state) {
  return Array.from(state.players.entries()).map(([id, p]) => ({
    id,
    username: p.username,
    isMaster: id === state.hostId,
    online: Boolean(p.socketId),
    isBot: Boolean(p.isBot),
  }));
}
