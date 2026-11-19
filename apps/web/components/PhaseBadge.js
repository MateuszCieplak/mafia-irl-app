'use client';

const PHASE_LABELS = {
  role_reveal: { label: 'Losowanie ról', color: 'bg-white/10 text-white/70' },
  night_mafia_card: { label: 'Noc — Karta mafii', color: 'bg-red-900/40 text-blood' },
  night_citizen_card: { label: 'Noc — Karta obywatela', color: 'bg-sky-900/50 text-sky-300' },
  night_detective: { label: 'Noc — Detektyw', color: 'bg-blue-900/50 text-blue-300' },
  night_doctor: { label: 'Noc — Lekarz', color: 'bg-emerald-900/50 text-emerald-300' },
  night_mafia: { label: 'Noc — Mafia', color: 'bg-red-900/50 text-blood' },
  night_resolve: { label: 'Noc — Rozstrzygnięcie', color: 'bg-purple-900/50 text-purple-300' },
  day_deliberation: { label: 'Dzień — Dyskusja', color: 'bg-amber-900/50 text-amber-300' },
  day_vote: { label: 'Dzień — Głosowanie', color: 'bg-orange-900/50 text-orange-300' },
  day_resolve: { label: 'Dzień — Rozstrzygnięcie', color: 'bg-yellow-900/50 text-yellow-300' },
};

export default function PhaseBadge({ phase, round, compact = false, animate = true }) {
  const info = PHASE_LABELS[phase] || { label: phase || 'Oczekiwanie', color: 'bg-white/10 text-white/60' };
  return (
    <div
      key={phase || 'none'}
      className={`${animate ? 'animate-badge-pop' : ''} inline-flex items-center gap-2 rounded-md uppercase tracking-wider font-semibold ring-1 ring-white/10 ${info.color} ${
        compact ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-xs'
      }`}
    >
      {round ? <span className="opacity-60">R{round}</span> : null}
      <span>{info.label}</span>
    </div>
  );
}
