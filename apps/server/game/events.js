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

/**
 * Wpis do „Podglądu live” mastera. Każdy wpis trafia też do `state.insightLog`
 * (z kolejnym `seq`), żeby po odświeżeniu strony / wybudzeniu telefonu master
 * dostał całą historię gry z get_game_state — również wpisy z czasu, gdy był offline.
 */
export function emitMasterInsight(io, state, payload) {
  if (!state.insightLog) state.insightLog = [];
  const entry = {
    ...payload,
    ...roomEventMeta(state),
    round: state.round ?? 0,
    seq: state.insightLog.length + 1,
  };
  state.insightLog.push(entry);

  const masterInfo = state.players.get(state.hostId);
  if (masterInfo?.socketId) {
    io.to(masterInfo.socketId).emit('master_game_insight', entry);
  }
}
