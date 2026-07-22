'use client';

import { useState } from 'react';

const TIMER_FIELDS = [
  { key: 'phase_timer_detective_sec', label: 'Detektyw (s)' },
  { key: 'phase_timer_doctor_sec', label: 'Lekarz (s)' },
  { key: 'phase_timer_mafia_sec', label: 'Mafia (s)' },
  { key: 'phase_timer_deliberation_sec', label: 'Dyskusja (s)' },
  { key: 'phase_timer_vote_sec', label: 'Głosowanie (s)' },
];

export default function RoomSettingsPanel({ settings, onSave, saving }) {
  const [local, setLocal] = useState(() => ({ ...defaultSettings(), ...settings }));

  function handleChange(key, value) {
    setLocal((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave?.(local);
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <h3 className="font-display text-sm font-bold text-white/50 uppercase tracking-wider">
        Ustawienia pokoju
      </h3>

      <div className="grid grid-cols-2 gap-3">
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

      <label className="flex items-center gap-2 text-sm text-white/70">
        <input
          type="checkbox"
          checked={local.doctor_repeat_protect === false}
          onChange={(e) => handleChange('doctor_repeat_protect', !e.target.checked)}
          className="rounded"
        />
        Lekarz nie może leczyć tej samej osoby dwa razy z rzędu
      </label>

      <label className="flex items-center gap-2 text-sm text-white/70">
        <input
          type="checkbox"
          checked={local.doctor_can_self_protect !== false}
          onChange={(e) => handleChange('doctor_can_self_protect', e.target.checked)}
          className="rounded"
        />
        Lekarz może leczyć siebie
      </label>

      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? 'Zapisuję…' : 'Zapisz ustawienia'}
      </button>
    </form>
  );
}

function defaultSettings() {
  return {
    phase_timer_detective_sec: 30,
    phase_timer_doctor_sec: 30,
    phase_timer_mafia_sec: 120,
    phase_timer_deliberation_sec: 300,
    phase_timer_vote_sec: 60,
    doctor_repeat_protect: false,
    doctor_can_self_protect: true,
  };
}
