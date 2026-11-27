// Karty mocy (tryb „Mafia zaawansowana”) — opisy i helpery wspólne dla komponentów.

export const CARD_PHASES = ['night_mafia_card', 'night_citizen_card'];

// `scope`: 'individual' — kartę ma jeden gracz; 'global' — wspólna dla całej drużyny.
// `teams`: dla której drużyny jest karta (`shield` ma wersję dla obu drużyn).
export const CARD_INFO = {
  check: {
    icon: '🔎',
    name: 'Sprawdzenie',
    team: 'Obywatel',
    teams: ['town'],
    scope: 'individual',
    how: 'W nocy wskazujesz 3 graczy i dowiadujesz się, ilu z nich to mafia. Mafia może to zakłócić swoimi kartami.',
    useHint:
      'Zgłoszenie jest tajne. W nocy master obudzi Cię „obok” reszty grupy — wtedy wybierzesz 3 graczy.',
  },
  reveal: {
    icon: '👁️',
    name: 'Odkrycie',
    team: 'Obywatel',
    teams: ['town'],
    scope: 'individual',
    how: 'W nocy wskazujesz dowolnego żywego gracza i dowiadujesz się, jaką rolę ma (mafia, detektyw, lekarz lub obywatel).',
    useHint:
      'Zgłoszenie jest tajne. W nocy master obudzi Cię „obok” reszty grupy — wtedy wskażesz gracza, którego rolę chcesz poznać.',
  },
  shield: {
    icon: '🛡️',
    name: 'Tarcza',
    team: 'Obywatel',
    teams: ['town'],
    scope: 'individual',
    how: 'Ma ją jeden obywatel. Jeśli z głosowania miałby odpaść obywatel, tarcza go ratuje i nikt nie odpada. Na mafię nie działa — wyrzucony mafioso odpada.',
    useHint:
      'Działa od razu, w tym głosowaniu. Po głosowaniu dowiesz się, kogo wskazano: jeśli tarcza zadziałała, to był obywatel; jeśli nie — mafia.',
  },
  mafia_shield: {
    icon: '🛡️',
    name: 'Tarcza mafii',
    team: 'Mafia',
    teams: ['mafia'],
    scope: 'global',
    how: 'Jeśli z głosowania miałby odpaść mafioso, tarcza go ratuje i nikt nie odpada. Na obywateli nie działa (wspólna dla całej mafii, jednorazowa).',
    useHint:
      'Działa od razu, w tym głosowaniu. Reszta graczy nie dowie się, kto jej użył. Po głosowaniu zobaczysz, czy zadziałała.',
  },
  alibi: {
    icon: '🕵️',
    name: 'Alibi',
    team: 'Mafia',
    teams: ['mafia'],
    scope: 'individual',
    how: 'Wybrany mafioso przy najbliższym Sprawdzeniu (kartą obywatela), które go obejmie, liczy się jako „czysty”. Nie działa na detektywa.',
    useHint: 'W nocy (tura karty mafii) wskażesz mafiozę, którego chcesz ukryć.',
  },
  jam: {
    icon: '📡',
    name: 'Zakłócenie',
    team: 'Mafia',
    teams: ['mafia'],
    scope: 'global',
    how: 'Najbliższe Sprawdzenie obywatela pokaże błędny wynik. Nie działa na detektywa.',
    useHint: 'W nocy (tura karty mafii) potwierdzisz aktywację. Wynik następnego Sprawdzenia będzie fałszywy.',
  },
  false_lead: {
    icon: '🎭',
    name: 'Fałszywy trop',
    team: 'Mafia',
    teams: ['mafia'],
    scope: 'individual',
    how: 'Wybrany niewinny gracz przy najbliższym Sprawdzeniu (kartą obywatela), które go obejmie, liczy się jako mafia. Nie działa na detektywa.',
    useHint: 'W nocy (tura karty mafii) wskażesz niewinnego gracza, na którego chcesz rzucić podejrzenie.',
  },
};

export const MAX_CARDS_PER_TEAM = 2;

/** Karty do wyboru w ustawieniach, osobno dla drużyn (Tarcza występuje w obu). */
export const CITIZEN_CARD_TYPES = ['check', 'reveal', 'shield'];
export const MAFIA_CARD_TYPES = ['mafia_shield', 'alibi', 'false_lead', 'jam'];

/** Czy typ karty jest „wspólny dla obu drużyn” (każda ma własną wersję Tarczy). */
export function isSharedCardType(type) {
  return type === 'shield' || type === 'mafia_shield';
}

/** Etykieta zakresu karty do list w panelu ustawień. */
export function cardScopeLabel(type) {
  const info = CARD_INFO[type];
  if (!info) return '';
  if (type === 'shield') return 'obie drużyny · u obywateli ma ją 1 gracz';
  if (type === 'mafia_shield') return 'obie drużyny · u mafii wspólna dla drużyny';
  const who = isSharedCardType(type) ? 'obie drużyny' : info.teams.includes('mafia') ? 'tylko mafia' : 'tylko obywatele';
  const scope = info.scope === 'global' ? 'wspólna dla drużyny' : 'indywidualna';
  return `${who} · ${scope}`;
}

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

const ROLE_PL = { mafia: 'Mafia', detective: 'Detektyw', doctor: 'Lekarz', citizen: 'Obywatel' };

/** Nazwa roli po polsku (wynik karty Odkrycie). */
export function roleLabelPl(role) {
  return ROLE_PL[role] || role || '—';
}

/** Zdanie opisujące wpis dziennika Odkrycia. */
export function revealEntrySentence(entry, nameOf) {
  return `Runda ${entry.round}: odkryto ${nameOf(entry.targetId)} — rola: ${roleLabelPl(entry.role)}`;
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
  if (entry.type === 'mafia_shield') {
    if (!entry.targetId) return `${base} — nikt nie był wyrzucany, tarcza przepadła`;
    return `${base} — ${nameOf(entry.targetId)}: ${entry.saved ? 'uratowany(a) przed wyrzuceniem' : 'tarcza nie zadziałała (to nie mafia)'}`;
  }
  return entry.targetId ? `${base} → ${nameOf(entry.targetId)}` : base;
}

/** Zdanie opisujące wynik tarczy dla jej użytkownika (obywatela lub mafii). */
export function shieldEntrySentence(entry, nameOf) {
  const base = `Runda ${entry.round}: Tarcza`;
  if (!entry.targetId) return `${base} — nikt nie był wyrzucany, karta przepadła`;
  const name = nameOf(entry.targetId);
  if (entry.saved) {
    return `${base} uratowała gracza ${name} — to ${entry.targetTeam === 'mafia' ? 'mafia' : 'obywatel'}`;
  }
  return `${base} nie zadziałała — ${name} odpadł(a), a to ${entry.targetTeam === 'mafia' ? 'mafia' : 'obywatel'}`;
}
