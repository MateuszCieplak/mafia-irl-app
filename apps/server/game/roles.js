/** Ustawiane tylko w testach (deterministyczne role). */
let assignRolesTestOverride = null;

export function setAssignRolesForTest(fn) {
  assignRolesTestOverride = fn;
}

export function clearAssignRolesForTest() {
  assignRolesTestOverride = null;
}

export function assignRoles(playerIds) {
  if (assignRolesTestOverride) {
    return assignRolesTestOverride(playerIds);
  }

  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  const count = shuffled.length;
  const roleMap = {};

  const mafiaCount = Math.max(1, Math.floor(count / 4));

  for (let i = 0; i < mafiaCount; i++) {
    roleMap[shuffled[i]] = 'mafia';
  }

  let idx = mafiaCount;

  if (idx < count) {
    roleMap[shuffled[idx]] = 'doctor';
    idx++;
  }

  if (idx < count) {
    roleMap[shuffled[idx]] = 'detective';
    idx++;
  }

  while (idx < count) {
    roleMap[shuffled[idx]] = 'citizen';
    idx++;
  }

  return roleMap;
}
