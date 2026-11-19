'use client';

import { useState } from 'react';
import { MAFIA_SPECIAL_OPTIONS, CARD_INFO } from '@/lib/cards';

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
              w fazie głosowania. Karty nocne (Sprawdzenie, karty mafii) działają w osobnych turach, w których master
              „budzi” gracza — jawnie, na oczach grupy, a master zawsze ogłasza, że użyto karty (nie mówiąc jakiej).
            </p>

            {local.advanced_mode === true && (
              <div className="panel space-y-3">
                <label className="setting-row">
                  <input
                    type="checkbox"
                    checked={local.card_check_enabled !== false}
                    onChange={(e) => handleChange('card_check_enabled', e.target.checked)}
                  />
                  Obywatele: {CARD_INFO.check.name}
                </label>
                {local.card_check_enabled !== false && (
                  <label className="space-y-1 block">
                    <span className="text-[12px] text-white/40 uppercase">Ile kart Sprawdzenia w grze</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="input text-sm py-2 min-h-0"
                      value={local.check_card_count ?? ''}
                      onChange={(e) => handleChange('check_card_count', e.target.value === '' ? '' : Number(e.target.value))}
                    />
                  </label>
                )}
                <p className="text-xs text-white/40 leading-relaxed">{CARD_INFO.check.how}</p>

                <label className="setting-row">
                  <input
                    type="checkbox"
                    checked={local.card_shield_citizen_enabled !== false}
                    onChange={(e) => handleChange('card_shield_citizen_enabled', e.target.checked)}
                  />
                  Obywatele: {CARD_INFO.shield.name} (1 karta)
                </label>
                <label className="setting-row">
                  <input
                    type="checkbox"
                    checked={local.card_shield_mafia_enabled !== false}
                    onChange={(e) => handleChange('card_shield_mafia_enabled', e.target.checked)}
                  />
                  Mafia: {CARD_INFO.mafia_shield.name} (1 karta dla drużyny)
                </label>
                <p className="text-xs text-white/40 leading-relaxed">
                  Tarcza unieważnia wyrzucenie z głosowania — kogokolwiek wybrano. Gracze widzą tylko „Podczas głosowania
                  nikt nie odpadł”, bez żadnej wzmianki o karcie. Zgłoszona tarcza przy remisie lub pominiętym głosowaniu
                  przepada po cichu.
                </p>

                <label className="space-y-1 block">
                  <span className="text-[12px] text-white/40 uppercase">Mafia: karta specjalna</span>
                  <select
                    className="input text-sm py-2 min-h-0"
                    value={local.card_mafia_special ?? 'alibi'}
                    onChange={(e) => handleChange('card_mafia_special', e.target.value)}
                  >
                    {MAFIA_SPECIAL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {['alibi', 'false_lead', 'jam'].includes(local.card_mafia_special ?? 'alibi') && (
                  <p className="text-xs text-white/40 leading-relaxed">
                    {CARD_INFO[local.card_mafia_special ?? 'alibi'].how} Efekt jest jednorazowy i czeka na najbliższe
                    Sprawdzenie; jeśli mafia zgłosi kartę w tym samym głosowaniu co obywatel, zadziała już w tej samej
                    nocy (tura mafii idzie pierwsza).
                  </p>
                )}

                <label className="space-y-1 block">
                  <span className="text-[12px] text-white/40 uppercase">Karty nocne działają od nocy rundy</span>
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
                  Tury kart pojawiają się w nocy tylko wtedy, gdy ktoś zgłosił użycie karty. Master ogłasza wtedy na głos
                  „użyto karty mocy” (bez podawania jakiej), więc nie trzeba blefować w pozostałych nocach.
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
    card_check_enabled: true,
    check_card_count: 1,
    card_shield_citizen_enabled: true,
    card_shield_mafia_enabled: true,
    card_mafia_special: 'alibi',
    card_min_round: 3,
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
  for (const key of ['detective_count', 'doctor_count', 'check_card_count', 'card_min_round']) {
    const n = Math.floor(Number(next[key]));
    next[key] = Number.isFinite(n) && n >= 1 ? n : 1;
  }
  return next;
}

/** Czy dwa zestawy ustawień różnią się (po scaleniu z domyślnymi, niezależnie od kolejności kluczy). */
export function settingsDiffer(a, b) {
  const x = mergeSettings(a);
  const y = mergeSettings(b);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) {
    if (x[k] !== y[k]) return true;
  }
  return false;
}
