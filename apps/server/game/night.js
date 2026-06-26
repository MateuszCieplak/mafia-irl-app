export async function resolveNight(state, pb) {
  const mafiaAction = state.nightActions.mafia;
  const doctorAction = state.nightActions.doctor;

  if (!mafiaAction) {
    return {
      eliminatedId: null,
      killed: null,
      protected: doctorAction?.targetId ?? null,
      protection_was_effective: false,
    };
  }

  const mafiaTarget = mafiaAction.targetId;
  const protectedTarget = doctorAction?.targetId ?? null;

  if (mafiaTarget === protectedTarget) {
    return {
      eliminatedId: null,
      killed: null,
      protected: protectedTarget,
      protection_was_effective: true,
    };
  }

  const targetIsBot = state.players?.get(mafiaTarget)?.isBot;
  if (targetIsBot) {
    if (!state.eliminatedBots) state.eliminatedBots = new Set();
    state.eliminatedBots.add(mafiaTarget);
  } else {
    const rpRecords = await pb.collection('room_players').getList(1, 1, {
      filter: `room_id = "${state.id}" && user_id = "${mafiaTarget}"`,
      requestKey: null,
    });
    if (rpRecords.items.length > 0) {
      await pb.collection('room_players').update(rpRecords.items[0].id, {
        eliminated_at: new Date().toISOString(),
      });
    }
  }

  return {
    eliminatedId: mafiaTarget,
    killed: mafiaTarget,
    protected: protectedTarget,
    protection_was_effective: false,
  };
}
