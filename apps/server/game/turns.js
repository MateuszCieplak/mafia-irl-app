/**
 * Tury nocne dla wielu lekarzy / detektywów.
 *
 * Faza (`night_detective`, `night_doctor`) pozostaje ta sama, a `state.nightTurn`
 * wskazuje, który z graczy danej roli ma teraz swoją turę (kolejność = kolejność
 * w `state.roles`). Mafia zawsze gra wspólnie w jednej turze.
 */
export const TURN_PHASE_ROLE = {
  night_detective: 'detective',
  night_doctor: 'doctor',
};

export function roleActorIds(state, role) {
  return Object.entries(state.roles || {})
    .filter(([, r]) => r === role)
    .map(([id]) => id);
}

/** Liczba tur w fazie — co najmniej 1 (master przeklikuje fazę nawet bez aktora). */
export function turnCount(state, phase) {
  // Tura karty obywatela: jedna tura na każde zgłoszone Sprawdzenie.
  if (phase === 'night_citizen_card') {
    return Math.max(1, state.cardQueue?.check?.length || 0);
  }
  // Tura karty mafii: jedna tura na każdą zgłoszoną kartę (aktorem jest jej właściciel).
  if (phase === 'night_mafia_card') {
    return Math.max(1, state.cardQueue?.mafia?.length || 0);
  }
  const role = TURN_PHASE_ROLE[phase];
  if (!role) return 1;
  return Math.max(1, roleActorIds(state, role).length);
}

/** Gracz, który ma teraz turę w bieżącej fazie nocnej (albo null). */
export function currentTurnActorId(state, role) {
  return roleActorIds(state, role)[state.nightTurn ?? 0] ?? null;
}

/** Indeks tury danego gracza w jego roli (albo null). */
export function turnIndexOf(state, userId) {
  const role = state.roles?.[userId];
  if (!TURN_PHASE_ROLE_VALUES.has(role)) return null;
  const idx = roleActorIds(state, role).indexOf(userId);
  return idx === -1 ? null : idx;
}
const TURN_PHASE_ROLE_VALUES = new Set(Object.values(TURN_PHASE_ROLE));

/** Kogo lekarz leczył w poprzedniej nocy (per lekarz; fallback dla starego stanu). */
export function prevDoctorTarget(state, actorId) {
  if (state.previousDoctorTargets) return state.previousDoctorTargets[actorId] ?? null;
  return state.previousDoctorProtectTarget ?? null;
}
