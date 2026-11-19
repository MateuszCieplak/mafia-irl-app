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
/** Maks. liczba mafii: 34% graczy (zaokrąglone w dół), ale co najmniej 1. */
export function maxMafiaCount(total) {
  return Math.max(1, Math.floor(total * 0.34));
}

function countSetting(settings, key) {
  const n = Math.floor(Number(settings?.[key]));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Docelowa liczba mafii: ręczna (limit 34%) albo automat — 1 na 4 graczy. */
export function mafiaTargetCount(settings, total) {
  const manualCount = Number(settings?.mafia_count);
  return settings?.mafia_count_manual === true && Number.isFinite(manualCount)
    ? Math.min(Math.max(1, Math.floor(manualCount)), maxMafiaCount(total))
    : Math.max(1, Math.floor(total / 4));
}

/** Limity ról w grze (wspólne dla losowania i walidacji ręcznych przypisań). */
export function roleLimits(settings, total) {
  return {
    mafia: mafiaTargetCount(settings, total),
    detective: countSetting(settings, 'detective_count'),
    doctor: countSetting(settings, 'doctor_count'),
  };
}

/** Pierwsze przekroczenie limitu w ręcznych przypisaniach mastera albo null. */
export function findRoleLimitViolation(playerIds, overrides = {}, settings = {}) {
  const limits = roleLimits(settings, playerIds.length);
  const counts = { mafia: 0, detective: 0, doctor: 0 };
  for (const [id, role] of Object.entries(overrides || {})) {
    if (!playerIds.includes(id) || counts[role] === undefined) continue;
    counts[role] += 1;
  }
  for (const role of ['mafia', 'detective', 'doctor']) {
    if (counts[role] > limits[role]) return { role, limit: limits[role] };
  }
  return null;
}

export function assignRoles(playerIds, overrides = {}, settings = {}) {
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
  // Tryb ręczny: master podaje liczbę mafii (limit 34% graczy). Domyślnie — automat.
  const limits = roleLimits(settings, total);
  const needMafia = Math.max(0, limits.mafia - assigned.mafia);
  const needDoctor = Math.max(0, limits.doctor - assigned.doctor);
  const needDetective = Math.max(0, limits.detective - assigned.detective);

  let idx = 0;

  for (let i = 0; i < needMafia && idx < unassigned.length; i++, idx++) {
    roleMap[unassigned[idx]] = 'mafia';
  }
  for (let i = 0; i < needDoctor && idx < unassigned.length; i++, idx++) {
    roleMap[unassigned[idx]] = 'doctor';
  }
  for (let i = 0; i < needDetective && idx < unassigned.length; i++, idx++) {
    roleMap[unassigned[idx]] = 'detective';
  }
  while (idx < unassigned.length) {
    roleMap[unassigned[idx++]] = 'citizen';
  }

  return roleMap;
}
