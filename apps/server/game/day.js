export async function resolveVotes(state, pb) {
  const voteCounts = new Map();
  let skipCount = 0;

  for (const [_, targetId] of state.votes) {
    if (!targetId) {
      skipCount++;
    } else {
      voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
    }
  }

  const totalVoters = state.votes.size;
  if (skipCount > totalVoters / 2) {
    return { eliminatedId: null, outcome: 'vote_skipped' };
  }

  let maxVotes = 0;
  let candidates = [];
  for (const [targetId, count] of voteCounts) {
    if (count > maxVotes) {
      maxVotes = count;
      candidates = [targetId];
    } else if (count === maxVotes) {
      candidates.push(targetId);
    }
  }

  if (candidates.length !== 1) {
    return { eliminatedId: null, outcome: 'tie' };
  }

  const eliminatedId = candidates[0];
  const targetIsBot = state.players?.get(eliminatedId)?.isBot;
  if (targetIsBot) {
    if (!state.eliminatedBots) state.eliminatedBots = new Set();
    state.eliminatedBots.add(eliminatedId);
  } else {
    const rpRecords = await pb.collection('room_players').getList(1, 1, {
      filter: `room_id = "${state.id}" && user_id = "${eliminatedId}"`,
      requestKey: null,
    });
    if (rpRecords.items.length > 0) {
      await pb.collection('room_players').update(rpRecords.items[0].id, {
        eliminated_at: new Date().toISOString(),
      });
    }
  }

  return { eliminatedId, outcome: 'eliminated' };
}

export async function checkWinCondition(state, pb) {
  const players = await pb.collection('room_players').getFullList({
    filter: `room_id = "${state.id}"`,
    requestKey: null,
  });

  const alive = players.filter((p) => !p.eliminated_at && p.role);

  // Uzupełnij o boty (nie mają rekordów w PB).
  if (state.players) {
    for (const [botId, info] of state.players.entries()) {
      if (!info.isBot) continue;
      const role = state.roles?.[botId];
      if (!role) continue;
      if (state.eliminatedBots?.has(botId)) continue;
      alive.push({ role, user_id: botId });
    }
  }

  const mafiaAlive = alive.filter((p) => p.role === 'mafia').length;
  const townAlive = alive.filter((p) => p.role !== 'mafia').length;

  if (mafiaAlive === 0) return 'town';
  if (mafiaAlive >= townAlive) return 'mafia';
  return null;
}
