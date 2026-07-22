export function roomEventMeta(state) {
  return {
    roomId: state.id,
    roomCode: state.code,
    timestamp: Date.now(),
  };
}

export function notifyMasterSubmission(io, state, role, details = {}) {
  const masterInfo = state.players.get(state.hostId);
  if (masterInfo?.socketId) {
    io.to(masterInfo.socketId).emit('night_action_submitted', {
      role,
      submitted: true,
      ...details,
      ...roomEventMeta(state),
    });
  }
}

export function emitMasterInsight(io, state, payload) {
  const masterInfo = state.players.get(state.hostId);
  if (masterInfo?.socketId) {
    io.to(masterInfo.socketId).emit('master_game_insight', {
      ...payload,
      ...roomEventMeta(state),
    });
  }
}
