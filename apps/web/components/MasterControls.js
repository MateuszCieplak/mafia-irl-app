'use client';

import { useState } from 'react';

const PHASE_ACTIONS = {
  null: 'Rozpocznij noc',
  night_detective: 'Detektyw → Lekarz',
  night_doctor: 'Lekarz → Mafia',
  night_mafia: 'Mafia → Rozstrzygnięcie nocy',
  night_resolve: 'Noc → Dzień (dyskusja)',
  day_deliberation: 'Dyskusja → Głosowanie',
  day_vote: 'Głosowanie → Rozstrzygnięcie',
  day_resolve: 'Następna runda',
};

const PHASE_QUOTES = {
  null: { icon: '🌙', text: 'Zapada noc…' },
  night_detective: { icon: '🔍', text: 'Budzi się Detektyw' },
  night_doctor: { icon: '💊', text: 'Budzi się Lekarz' },
  night_mafia: { icon: '🔫', text: 'Budzi się Mafia' },
  night_resolve: { icon: '🌅', text: 'Rozstrzygnięcie nocy' },
  day_deliberation: { icon: '🗣️', text: 'Czas na dyskusję' },
  day_vote: { icon: '🗳️', text: 'Głosowanie' },
  day_resolve: { icon: '⚖️', text: 'Rozstrzygnięcie głosowania' },
};

export default function MasterControls({ phase, submissions, onAdvance, onEndGame }) {
  const [advancing, setAdvancing] = useState(false);
  const [ending, setEnding] = useState(false);
  const label = PHASE_ACTIONS[phase] ?? PHASE_ACTIONS[null];
  const quote = PHASE_QUOTES[phase] ?? PHASE_QUOTES[null];

  async function handleAdvance() {
    setAdvancing(true);
    await onAdvance();
    setAdvancing(false);
  }

  async function handleEnd() {
    if (!confirm('Na pewno zakończyć rozgrywkę? Wszyscy gracze zobaczą ekran końca gry.')) return;
    setEnding(true);
    await onEndGame?.();
    setEnding(false);
  }

  return (
    <div className="card space-y-3">
      <h3 className="font-display font-bold text-sm text-white/50 uppercase tracking-wider">
        Panel Mastera
      </h3>

      {/* Cytat fazowy */}
      <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
        <span className="text-lg">{quote.icon}</span>
        <span className="font-display font-semibold text-white/90 text-sm">{quote.text}</span>
      </div>

      {submissions && Object.keys(submissions).length > 0 && (
        <div className="space-y-1">
          {Object.entries(submissions).map(([role, submitted]) => (
            <div key={role} className="flex items-center justify-between text-sm">
              <span className="capitalize text-white/70">{role}</span>
              <span className={submitted ? 'text-safe font-semibold' : 'text-white/30'}>
                {submitted ? '✓ Gotowe' : 'Oczekuje…'}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleAdvance}
        disabled={advancing}
        className="btn-primary w-full"
      >
        {advancing ? 'Przechodzenie…' : label}
      </button>

      {onEndGame && (
        <button
          onClick={handleEnd}
          disabled={ending}
          className="w-full text-xs text-blood/80 hover:text-blood underline-offset-2 hover:underline py-1"
        >
          {ending ? 'Kończenie…' : 'Zakończ rozgrywkę'}
        </button>
      )}
    </div>
  );
}
