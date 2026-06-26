'use client';

const PHASE_FLAVOR = {
  null: { icon: '🌙', text: 'Zapada noc…' },
  night_detective: { icon: '🔍', text: 'Detektyw sprawdza podejrzanego…' },
  night_doctor: { icon: '💊', text: 'Lekarz chroni wybraną osobę…' },
  night_mafia: { icon: '🔫', text: 'Mafia naradza się w cieniu…' },
  night_resolve: { icon: '🌅', text: 'Noc dobiega końca…' },
  day_deliberation: { icon: '🗣️', text: 'Czas na dyskusję' },
  day_vote: { icon: '🗳️', text: 'Czas głosowania' },
  day_resolve: { icon: '⚖️', text: 'Rozstrzygnięcie głosowania…' },
};

export default function PlayerPhaseInfo({ phase, lastResult }) {
  const flavor = PHASE_FLAVOR[phase] ?? PHASE_FLAVOR[null];

  return (
    <div className="space-y-2">
      {/* Cytat fazowy */}
      <div className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2">
        <span className="text-base">{flavor.icon}</span>
        <span className="text-sm text-white/70 italic">{flavor.text}</span>
      </div>

      {/* Wynik ostatniej nocy lub głosowania */}
      {lastResult && (
        <div
          className={`rounded-lg px-3 py-2 border text-sm font-semibold text-center ${
            lastResult.type === 'elimination'
              ? 'bg-blood/15 border-blood/40 text-white'
              : 'bg-white/5 border-white/10 text-white/70'
          }`}
        >
          {lastResult.message}
        </div>
      )}
    </div>
  );
}
