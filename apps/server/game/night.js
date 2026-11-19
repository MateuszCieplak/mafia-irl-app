export async function resolveNight(state, pb) {
  const mafiaAction = state.nightActions.mafia;
  const doctorAction = state.nightActions.doctor;
  // Wielu lekarzy: każdy chroni swój cel — ochrona działa, gdy cel mafii jest w zbiorze.
  const protectedAll = [
    ...Object.values(state.nightActions.protections || {}),
    ...(doctorAction?.targetId ? [doctorAction.targetId] : []),
  ].filter(Boolean);
  const protectedSet = new Set(protectedAll);

  if (!mafiaAction) {
    return {
      eliminatedId: null,
      killed: null,
      protected: protectedAll[0] ?? null,
      protectedAll: [...protectedSet],
      protection_was_effective: false,
    };
  }

  const mafiaTarget = mafiaAction.targetId;
  const protectedTarget = protectedSet.has(mafiaTarget) ? mafiaTarget : protectedAll[0] ?? null;

  // Immunitet detektywa w 1. nocy: dla graczy wynik identyczny jak spokojna noc /
  // udana ochrona (eliminatedId null) — tylko master dostaje flagę w insight.
  if (
    state.settings?.detective_first_night_immunity === true &&
    state.round === 1 &&
    state.roles?.[mafiaTarget] === 'detective'
  ) {
    return {
      eliminatedId: null,
      killed: null,
      protected: protectedTarget,
      protectedAll: [...protectedSet],
      protection_was_effective: false,
      detective_immunity_triggered: true,
    };
  }

  if (protectedSet.has(mafiaTarget)) {
    return {
      eliminatedId: null,
      killed: null,
      protected: protectedTarget,
      protectedAll: [...protectedSet],
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
    protectedAll: [...protectedSet],
    protection_was_effective: false,
  };
}
