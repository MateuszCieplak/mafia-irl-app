// Karty mocy (tryb „Mafia zaawansowana”) — opisy i helpery wspólne dla komponentów.

export const CARD_PHASES = ['night_mafia_card', 'night_citizen_card'];

export const CARD_INFO = {
  check: {
    icon: '🔎',
    name: 'Sprawdzenie',
    team: 'Obywatel',
    how: 'W nocy wskazujesz 3 graczy i dowiadujesz się, ilu z nich to mafia.',
    useHint:
      'Zgłoszenie jest tajne. W nocy master obudzi Cię „obok” reszty grupy — wtedy wybierzesz 3 graczy.',
  },
  shield: {
    icon: '🛡️',
    name: 'Tarcza',
    team: 'Obywatel',
    how: 'Unieważnia wyrzucenie z głosowania: jeśli wioska wybierze kogokolwiek, nikt nie odpada (reszta zobaczy tylko „nikt nie odpadł”).',
    useHint:
      'Działa od razu, w tym głosowaniu. Uwaga: ochroni każdego wybranego — także mafię.',
  },
  mafia_shield: {
    icon: '🛡️',
    name: 'Tarcza mafii',
    team: 'Mafia',
    how: 'Unieważnia wyrzucenie z głosowania (wspólna dla całej mafii, jednorazowa).',
    useHint: 'Działa od razu, w tym głosowaniu. Reszta graczy nie dowie się, kto jej użył.',
  },
  alibi: {
    icon: '🕵️',
    name: 'Alibi',
    team: 'Mafia',
    how: 'Wybrany mafioso przy najbliższym Sprawdzeniu, które go obejmie, liczy się jako „czysty”.',
    useHint: 'W nocy (tura karty mafii) wskażecie mafiozę, którego chcecie ukryć.',
  },
  jam: {
    icon: '📡',
    name: 'Zakłócenie',
    team: 'Mafia',
    how: 'Najbliższe Sprawdzenie obywatela pokaże błędny wynik.',
    useHint: 'W nocy (tura karty mafii) potwierdzicie aktywację. Wynik następnego Sprawdzenia będzie fałszywy.',
  },
  false_lead: {
    icon: '🎭',
    name: 'Fałszywy trop',
    team: 'Mafia',
    how: 'Wybrany niewinny gracz przy najbliższym Sprawdzeniu, które go obejmie, liczy się jako mafia.',
    useHint: 'W nocy (tura karty mafii) wskażecie niewinnego gracza, na którego chcecie rzucić podejrzenie.',
  },
};

export const MAFIA_SPECIAL_OPTIONS = [
  { value: 'alibi', label: 'Alibi' },
  { value: 'false_lead', label: 'Fałszywy trop' },
  { value: 'jam', label: 'Zakłócenie' },
  { value: 'none', label: 'Brak karty specjalnej' },
];

/** „1 mafia”, „2 mafie”, „5 mafii” — polska odmiana. */
export function mafiaCountLabel(n) {
  if (n === 1) return '1 mafia';
  if (n >= 2 && n <= 4) return `${n} mafie`;
  return `${n} mafii`;
}

/** Zdanie opisujące wpis dziennika Sprawdzenia. */
export function checkEntrySentence(entry, nameOf) {
  const names = (entry.targetIds || []).map(nameOf).join(', ');
  return `Runda ${entry.round}: sprawdzeni ${names} — ${mafiaCountLabel(entry.count)} w tej grupie`;
}

/**
 * Znaczniki przy graczach wynikające z dziennika Sprawdzenia:
 * { [playerId]: [{ count, total, round }] }.
 */
export function buildCheckTags(cardLog = []) {
  const tags = {};
  for (const entry of cardLog) {
    if (entry.kind !== 'check') continue;
    for (const id of entry.targetIds || []) {
      (tags[id] ||= []).push({
        count: entry.count,
        total: (entry.targetIds || []).length,
        round: entry.round,
      });
    }
  }
  return tags;
}

export function mafiaCardEntrySentence(entry, nameOf) {
  const info = CARD_INFO[entry.type];
  const base = `Runda ${entry.round}: użyto karty „${info?.name || entry.type}”`;
  return entry.targetId ? `${base} → ${nameOf(entry.targetId)}` : base;
}
