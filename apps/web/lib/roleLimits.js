// Lustro `roleLimits` z serwera (apps/server/game/roles.js) — limity ról dla ręcznych przypisań.
function countSetting(settings, key) {
  const n = Math.floor(Number(settings?.[key]));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function computeRoleLimits(settings, total) {
  const maxMafia = Math.max(1, Math.floor(total * 0.34));
  const manual = Number(settings?.mafia_count);
  const mafia =
    settings?.mafia_count_manual === true && Number.isFinite(manual)
      ? Math.min(Math.max(1, Math.floor(manual)), maxMafia)
      : Math.max(1, Math.floor(total / 4));
  return {
    mafia,
    detective: countSetting(settings, 'detective_count'),
    doctor: countSetting(settings, 'doctor_count'),
  };
}

export const LIMIT_MESSAGES = {
  mafia: 'Obecnie jest ustawiona maksymalna ilość mafii w grze',
  detective: 'Obecnie jest ustawiona maksymalna ilość detektywów w grze',
  doctor: 'Obecnie jest ustawiona maksymalna ilość lekarzy w grze',
};
