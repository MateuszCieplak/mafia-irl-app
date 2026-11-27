'use client';

import { useState } from 'react';
import {
  CARD_INFO,
  CITIZEN_CARD_TYPES,
  MAFIA_CARD_TYPES,
  MAX_CARDS_PER_TEAM,
  cardScopeLabel,
  isSharedCardType,
} from '@/lib/cards';

const CARD_TEAMS = {
  town: {
    label: 'Obywatele',
    types: CITIZEN_CARD_TYPES,
    countKey: 'card_citizen_count',
    poolKey: 'card_citizen_pool',
    manualKey: 'card_citizen_manual',
  },
  mafia: {
    label: 'Mafia',
    types: MAFIA_CARD_TYPES,
    countKey: 'card_mafia_count',
    poolKey: 'card_mafia_pool',
    manualKey: 'card_mafia_manual',
  },
};

/** Ustawienia kart jednej drużyny: losowanie z puli (liczba + dozwolone karty) albo ręczne sloty. */
function CardTeamSettings({ team, local, onChange }) {
  const cfg = CARD_TEAMS[team];
  const manual = local.card_assignment === 'manual';
  const pool = local[cfg.poolKey] ?? cfg.types;
  const slots = local[cfg.manualKey] ?? [];

  function togglePool(type, on) {
    const next = on ? [...new Set([...pool, type])] : pool.filter((t) => t !== type);
    onChange(cfg.poolKey, cfg.types.filter((t) => next.includes(t)));
  }

  function setSlot(index, type) {
    const next = Array.from({ length: MAX_CARDS_PER_TEAM }, (_, i) => slots[i] || '');
    next[index] = type;
    onChange(cfg.manualKey, next.filter(Boolean));
  }

  return (
    <div className="space-y-3">
      {manual ? (
        <div className="space-y-2">
          <p className="text-[12px] text-white/40 uppercase">Karty rozdane w grze (max {MAX_CARDS_PER_TEAM})</p>
          {Array.from({ length: MAX_CARDS_PER_TEAM }, (_, i) => (
            <label key={i} className="space-y-1 block">
              <span className="text-[12px] text-white/40">Slot {i + 1}</span>
              <select
                className="input text-sm py-2 min-h-0"
                value={slots[i] || ''}
                onChange={(e) => setSlot(i, e.target.value)}
              >
                <option value="">— brak karty —</option>
                {cfg.types.map((t) => (
                  <option key={t} value={t}>
                    {CARD_INFO[t].icon} {CARD_INFO[t].name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : (
        <>
          <label className="space-y-1 block">
            <span className="text-[12px] text-white/40 uppercase">
              Ile kart losować (0–{MAX_CARDS_PER_TEAM})
            </span>
            <input
              type="number"
              min={0}
              max={MAX_CARDS_PER_TEAM}
              step={1}
              className="input text-sm py-2 min-h-0"
              value={local[cfg.countKey] ?? ''}
              onChange={(e) => onChange(cfg.countKey, e.target.value === '' ? '' : Number(e.target.value))}
            />
          </label>
          <div className="space-y-1.5">
            <p className="text-[12px] text-white/40 uppercase">Pula kart do losowania</p>
            {cfg.types.map((t) => (
              <label key={t} className="setting-row">
                <input
                  type="checkbox"
                  checked={pool.includes(t)}
                  onChange={(e) => togglePool(t, e.target.checked)}
                />
                <span>
                  {CARD_INFO[t].icon} {CARD_INFO[t].name}
                  <span className="block text-[11px] text-white/35">{cardScopeLabel(t)}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-white/40 leading-relaxed">
            Losowane są różne karty z puli — jeśli pula ma mniej kart niż wybrana liczba, w grze będzie ich mniej.
          </p>
        </>
      )}

      <ul className="space-y-1.5">
        {cfg.types.map((t) => (
          <li key={t} className="text-xs text-white/45 leading-relaxed">
            <span className="text-white/70 font-semibold">
              {CARD_INFO[t].icon} {CARD_INFO[t].name}
              {isSharedCardType(t) ? ' (występuje w obu drużynach)' : ''}:
            </span>{' '}
            {CARD_INFO[t].how}
          </li>
        ))}
      </ul>
    </div>
  );
}

const TIMER_FIELDS = [
  { key: 'phase_timer_detective_sec', label: 'Detektyw (s)' },
  { key: 'phase_timer_doctor_sec', label: 'Lekarz (s)' },
  { key: 'phase_timer_mafia_sec', label: 'Mafia (s)' },
  { key: 'phase_timer_deliberation_sec', label: 'Dyskusja (s)' },
  { key: 'phase_timer_vote_sec', label: 'Głosowanie (s)' },
];

// Podzakładki ustawień pokoju.
const SUB_TABS = [
  { id: 'roles', label: 'Skład' },
  { id: 'rules', label: 'Zasady nocy' },
  { id: 'timers', label: 'Timery' },
  { id: 'advanced', label: 'Mafia zaawansowana' },
  { id: 'room', label: 'Pokój' },
];

/**
 * Panel ustawień pokoju — komponent kontrolowany.
 * Stan roboczy (`value`) i zapis trzyma strona nadrzędna, bo przycisk „Zapisz
 * ustawienia” stoi w nagłówku obok „Rozpocznij grę”.
 */
export default function RoomSettingsPanel({ value, onChange, playerCount = 0, dangerZone = null }) {
  const [sub, setSub] = useState('roles');
  const [cardTeam, setCardTeam] = useState('town');
  const local = value || defaultSettings();

  function handleChange(key, v) {
    onChange?.({ ...local, [key]: v });
  }

  const maxMafia = Math.max(1, Math.floor(playerCount * 0.34));
  const autoMafia = Math.max(1, Math.floor(playerCount / 4));
  const manualMafia = local.mafia_count_manual === true;
  const timersOn = local.phase_timers_enabled === true;

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Kategorie ustawień"
        className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
      >
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={sub === t.id}
            onClick={() => setSub(t.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors ${
              sub === t.id
                ? 'bg-brass-500/20 text-brass-400 border-brass-500/60'
                : 'bg-white/5 text-paper-200/60 border-white/10 hover:text-paper-100 hover:border-brass-500/40'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div key={sub} className="space-y-3 animate-fade-up">
        {sub === 'roles' && (
          <>
            <label className="setting-row">
              <input
                type="checkbox"
                checked={manualMafia}
                onChange={(e) => handleChange('mafia_count_manual', e.target.checked)}
              />
              Ustaw liczbę mafii ręcznie
            </label>

            {manualMafia ? (
              <div className="panel space-y-1">
                <span className="text-[12px] text-white/40 uppercase">Liczba mafii</span>
                <input
                  type="number"
                  min={1}
                  max={maxMafia}
                  className="input text-sm py-2 min-h-0"
                  value={local.mafia_count ?? ''}
                  onChange={(e) => handleChange('mafia_count', e.target.value === '' ? '' : Number(e.target.value))}
                />
                <p className="text-xs text-white/40 leading-relaxed">
                  Maksymalnie {maxMafia} przy {playerCount} graczach (do 34% graczy).
                </p>
              </div>
            ) : (
              <p className="text-xs text-white/40 leading-relaxed px-1">
                Liczba mafii liczona automatycznie ({autoMafia} przy {playerCount} graczach).
              </p>
            )}

            <div className="panel grid grid-cols-2 gap-3">
              {[
                ['detective_count', 'Liczba detektywów'],
                ['doctor_count', 'Liczba lekarzy'],
              ].map(([key, label]) => (
                <label key={key} className="space-y-1">
                  <span className="text-[12px] text-white/40 uppercase">{label}</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="input text-sm py-2 min-h-0"
                    value={local[key] ?? ''}
                    onChange={(e) => handleChange(key, e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </label>
              ))}
              <p className="col-span-2 text-xs text-white/40 leading-relaxed">
                Każdy detektyw i lekarz ma własną turę w nocy (np. Detektyw 1, Detektyw 2, Lekarz 1…) i nie
                wie, kim są pozostali. Mafia gra wspólnie w jednej turze.
              </p>
            </div>
          </>
        )}

        {sub === 'rules' && (
          <>
            <label className="setting-row">
              <input
                type="checkbox"
                checked={local.doctor_repeat_protect === false}
                onChange={(e) => handleChange('doctor_repeat_protect', !e.target.checked)}
              />
              Lekarz nie może leczyć tej samej osoby dwa razy z rzędu
            </label>

            <label className="setting-row">
              <input
                type="checkbox"
                checked={local.doctor_can_self_protect !== false}
                onChange={(e) => handleChange('doctor_can_self_protect', e.target.checked)}
              />
              Lekarz może leczyć siebie
            </label>

            <label className="setting-row">
              <input
                type="checkbox"
                checked={local.detective_first_night_immunity === true}
                onChange={(e) => handleChange('detective_first_night_immunity', e.target.checked)}
              />
              Detektyw nie może zginąć w pierwszej nocy
            </label>
            <p className="text-xs text-white/40 leading-relaxed px-1 -mt-1">
              Gdy włączone, w pierwszej nocy detektyw przetrwa nawet wtedy, gdy zostanie wybrany do
              eliminacji.
            </p>
          </>
        )}

        {sub === 'timers' && (
          <>
            <label className="setting-row">
              <input
                type="checkbox"
                checked={timersOn}
                onChange={(e) => handleChange('phase_timers_enabled', e.target.checked)}
              />
              Włącz timery faz
            </label>

            {timersOn ? (
              <div className="panel grid grid-cols-2 sm:grid-cols-3 gap-3">
                {TIMER_FIELDS.map(({ key, label }) => (
                  <label key={key} className="space-y-1">
                    <span className="text-[12px] text-white/40 uppercase">{label}</span>
                    <input
                      type="number"
                      min={5}
                      max={600}
                      className="input text-sm py-2 min-h-0"
                      value={local[key] ?? ''}
                      onChange={(e) => handleChange(key, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/40 leading-relaxed px-1">
                Bez timerów fazy przełącza wyłącznie master z kokpitu.
              </p>
            )}
          </>
        )}

        {sub === 'advanced' && (
          <>
            <label className="setting-row">
              <input
                type="checkbox"
                checked={local.advanced_mode === true}
                onChange={(e) => handleChange('advanced_mode', e.target.checked)}
              />
              Mafia zaawansowana (karty mocy)
            </label>
            <p className="text-xs text-white/40 leading-relaxed px-1 -mt-1">
              Część graczy dostaje na starcie tajną, jednorazową kartę. Kartę zgłasza się przyciskiem „Użyj karty”
              w fazie głosowania. Karty nocne (Sprawdzenie, Odkrycie, karty mafii) działają w osobnych turach, w
              których master „budzi” gracza.
            </p>

            {local.advanced_mode === true && (
              <div className="panel space-y-4">
                <div className="space-y-2">
                  <p className="text-[12px] text-white/40 uppercase">Rozdawanie kart</p>
                  <div className="flex gap-1.5" role="radiogroup" aria-label="Sposób rozdawania kart">
                    {[
                      { id: 'random', label: 'Losowo' },
                      { id: 'manual', label: 'Ręcznie (master)' },
                    ].map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={(local.card_assignment ?? 'random') === o.id}
                        onClick={() => handleChange('card_assignment', o.id)}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold border transition-colors ${
                          (local.card_assignment ?? 'random') === o.id
                            ? 'bg-brass-500/20 text-brass-400 border-brass-500/60'
                            : 'bg-white/5 text-paper-200/60 border-white/10 hover:border-brass-500/40'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-white/40 leading-relaxed">
                    Maksymalnie {MAX_CARDS_PER_TEAM} karty na drużynę. Losowo: serwer dobiera karty z puli przy starcie
                    gry. Ręcznie: wskazujesz dokładnie, jakie karty trafią do obywateli i do mafii.
                  </p>
                </div>

                <label className="space-y-1 block">
                  <span className="text-[12px] text-white/40 uppercase">
                    Karty nocne można zgłosić od głosowania w rundzie
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="input text-sm py-2 min-h-0"
                    value={local.card_min_round ?? ''}
                    onChange={(e) => handleChange('card_min_round', e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </label>
                <p className="text-xs text-white/40 leading-relaxed">
                  Dotyczy Sprawdzenia, Alibi, Fałszywego tropu i Zakłócenia. Kartę zgłasza się w głosowaniu rundy
                  {' '}{local.card_min_round || 3} lub późniejszej, a jej tura nocna jest w nocy kolejnej rundy (domyślnie:
                  zgłoszenie w rundzie 3, efekt w nocy 4). Tarcze działają od początku gry.
                </p>

                <div className="space-y-3">
                  <div
                    role="tablist"
                    aria-label="Drużyna"
                    className="flex gap-1.5"
                  >
                    {Object.entries(CARD_TEAMS).map(([id, t]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={cardTeam === id}
                        onClick={() => setCardTeam(id)}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider border transition-colors ${
                          cardTeam === id
                            ? id === 'mafia'
                              ? 'bg-blood/25 text-paper-100 border-blood/60'
                              : 'bg-brass-500/20 text-brass-400 border-brass-500/60'
                            : 'bg-white/5 text-paper-200/60 border-white/10 hover:border-brass-500/40'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <CardTeamSettings team={cardTeam} local={local} onChange={handleChange} />
                </div>

                <p className="text-xs text-white/40 leading-relaxed">
                  Tarcza ma wersję dla obu drużyn, ale chroni tylko swoich: tarcza obywateli (ma ją jeden obywatel)
                  ratuje wyrzuconego obywatela, tarcza mafii (wspólna dla mafii) — wyrzuconego mafiosa. Gracze widzą tylko „Podczas głosowania nikt nie
                  odpadł”; użytkownik tarczy dowiaduje się prywatnie, czy zadziałała. Alibi, Fałszywy trop i Zakłócenie
                  działają tylko na kartę Sprawdzenia, nie na detektywa. Nieużyta karta wyeliminowanego gracza
                  przechodzi na żywego gracza jego drużyny.
                </p>
              </div>
            )}
          </>
        )}

        {sub === 'room' && dangerZone}
      </div>
    </div>
  );
}

export function defaultSettings() {
  return {
    phase_timers_enabled: false,
    phase_timer_detective_sec: 30,
    phase_timer_doctor_sec: 30,
    phase_timer_mafia_sec: 120,
    phase_timer_deliberation_sec: 300,
    phase_timer_vote_sec: 60,
    doctor_repeat_protect: false,
    doctor_can_self_protect: true,
    detective_first_night_immunity: false,
    mafia_count_manual: false,
    mafia_count: 2,
    detective_count: 1,
    doctor_count: 1,
    advanced_mode: false,
    card_min_round: 3,
    card_assignment: 'random',
    card_citizen_count: 2,
    card_citizen_pool: [...CITIZEN_CARD_TYPES],
    card_citizen_manual: ['check', 'shield'],
    card_mafia_count: 2,
    card_mafia_pool: [...MAFIA_CARD_TYPES],
    card_mafia_manual: ['mafia_shield', 'alibi'],
  };
}

export function mergeSettings(settings) {
  return {
    ...defaultSettings(),
    ...(settings || {}),
    // Tylko jawne `true` włącza timery — unikamy truthy stringów z JSON.
    phase_timers_enabled: settings?.phase_timers_enabled === true,
    mafia_count_manual: settings?.mafia_count_manual === true,
    detective_first_night_immunity: settings?.detective_first_night_immunity === true,
    advanced_mode: settings?.advanced_mode === true,
  };
}

/** Ustawienia gotowe do wysłania na serwer (przycięte liczby) — dawne handleSubmit. */
export function sanitizeSettings(settings, playerCount = 0) {
  const next = mergeSettings(settings);
  if (next.mafia_count_manual) {
    const maxMafia = Math.max(1, Math.floor(playerCount * 0.34));
    const n = Math.floor(Number(next.mafia_count));
    next.mafia_count = Math.min(Math.max(1, Number.isFinite(n) ? n : 1), maxMafia);
  }
  for (const key of ['detective_count', 'doctor_count', 'card_min_round']) {
    const n = Math.floor(Number(next[key]));
    next[key] = Number.isFinite(n) && n >= 1 ? n : key === 'card_min_round' ? 3 : 1;
  }
  for (const key of ['card_citizen_count', 'card_mafia_count']) {
    const n = Math.floor(Number(next[key]));
    next[key] = Number.isFinite(n) ? Math.min(MAX_CARDS_PER_TEAM, Math.max(0, n)) : MAX_CARDS_PER_TEAM;
  }
  next.card_assignment = next.card_assignment === 'manual' ? 'manual' : 'random';
  const keepTypes = (list, allowed, max) =>
    (Array.isArray(list) ? list : []).filter((t) => allowed.includes(t)).slice(0, max);
  next.card_citizen_pool = keepTypes(next.card_citizen_pool, CITIZEN_CARD_TYPES, CITIZEN_CARD_TYPES.length);
  next.card_mafia_pool = keepTypes(next.card_mafia_pool, MAFIA_CARD_TYPES, MAFIA_CARD_TYPES.length);
  next.card_citizen_manual = keepTypes(next.card_citizen_manual, CITIZEN_CARD_TYPES, MAX_CARDS_PER_TEAM);
  next.card_mafia_manual = keepTypes(next.card_mafia_manual, MAFIA_CARD_TYPES, MAX_CARDS_PER_TEAM);
  // Porzucone klucze sprzed podziału na drużyny.
  for (const k of [
    'card_check_enabled',
    'card_shield_citizen_enabled',
    'card_shield_mafia_enabled',
    'card_mafia_special',
    'check_card_count',
  ]) {
    delete next[k];
  }
  return next;
}

/** Czy dwa zestawy ustawień różnią się (po scaleniu z domyślnymi, niezależnie od kolejności kluczy). */
export function settingsDiffer(a, b) {
  const x = mergeSettings(a);
  const y = mergeSettings(b);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) {
    // Listy (pule kart) porównujemy po zawartości, nie po referencji.
    const same = Array.isArray(x[k]) || Array.isArray(y[k]) ? JSON.stringify(x[k]) === JSON.stringify(y[k]) : x[k] === y[k];
    if (!same) return true;
  }
  return false;
}
