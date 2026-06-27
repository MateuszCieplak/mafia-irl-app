/** Ustawiane tylko w testach (deterministyczne role). */
let assignRolesTestOverride = null;

export function setAssignRolesForTest(fn) {
  assignRolesTestOverride = fn;
}

export function clearAssignRolesForTest() {
  assignRolesTestOverride = null;
}

/**
 * Assign roles to players.
 * @param {string[]} playerIds - all participant IDs (excluding master)
 * @param {Record<string,string>} overrides - master's manual picks { playerId: role }
 */
export function assignRoles(playerIds, overrides = {}) {
  if (assignRolesTestOverride) {
    return assignRolesTestOverride(playerIds);
  }

  const VALID_ROLES = new Set(['mafia', 'detective', 'doctor', 'citizen']);
  const roleMap = {};

  // Apply valid manual overrides first
  const assignedIds = new Set();
  for (const [id, role] of Object.entries(overrides)) {
    if (playerIds.includes(id) && VALID_ROLES.has(role)) {
      roleMap[id] = role;
      assignedIds.add(id);
    }
  }

  // Shuffle the remaining unassigned players
  const unassigned = playerIds.filter((id) => !assignedIds.has(id)).sort(() => Math.random() - 0.5);
  const total = playerIds.length;

  // Count how many of each role is already assigned
  const assigned = { mafia: 0, doctor: 0, detective: 0, citizen: 0 };
  for (const r of Object.values(roleMap)) {
    if (assigned[r] !== undefined) assigned[r]++;
  }

  // Calculate targets for random pool
  const mafiaTarget = Math.max(1, Math.floor(total / 4));
  const needMafia = Math.max(0, mafiaTarget - assigned.mafia);
  const needDoctor = Math.max(0, 1 - assigned.doctor);
  const needDetective = Math.max(0, 1 - assigned.detective);

  let idx = 0;

  for (let i = 0; i < needMafia && idx < unassigned.length; i++, idx++) {
    roleMap[unassigned[idx]] = 'mafia';
  }
  if (needDoctor && idx < unassigned.length) {
    roleMap[unassigned[idx++]] = 'doctor';
  }
  if (needDetective && idx < unassigned.length) {
    roleMap[unassigned[idx++]] = 'detective';
  }
  while (idx < unassigned.length) {
    roleMap[unassigned[idx++]] = 'citizen';
  }

  return roleMap;
}
