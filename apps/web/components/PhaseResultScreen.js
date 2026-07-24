'use client';

import { useState } from 'react';

/**
 * Ekran rozstrzygnięcia nocy / głosowania — pełnoprawna faza gry, a nie popup.
 *
 * Wynik jest sterowany fazą (`night_resolve`, `day_resolve`), nie momentem
 * dotarcia eventu: gracz, którego telefon spał, gdy master rozstrzygał noc, po
 * odblokowaniu ekranu nadal go widzi. Faza kończy się wyłącznie kliknięciem
 * mastera — dlatego master dostaje ten sam ekran z przyciskiem przejścia dalej
 * (`onAdvance`), a nie tylko zmieniony napis w kokpicie.
 */
export default function PhaseResultScreen({
  result,
  players,
  currentUserId,
  round,
  onAdvance,
  advanceLabel,
  onEndGame,
}) {
  // `phase_changed` potrafi dotrzeć ułamek sekundy przed `night_resolved`,
  // więc pokazujemy stan przejściowy zamiast migać ekranem roli.
  if (!result) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-white/40 animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
        <p className="text-white/40 text-sm">Rozstrzyganie…</p>
      </div>
    );
  }

  const isNight = result.kind === 'night';
  const victim = result.eliminatedPlayerId
    ? players?.find((p) => p.id === result.eliminatedPlayerId)
    : null;
  const victimName = victim?.username || result.eliminatedPlayerId;
  const isMe = Boolean(result.eliminatedPlayerId) && result.eliminatedPlayerId === currentUserId;

  const eyebrow = isNight ? `Noc ${round || ''}`.trim() : `Głosowanie · runda ${round || ''}`.trim();

  let icon;
  let headline;
  let detail;
  let accent;

  if (result.eliminatedPlayerId) {
    icon = '💀';
    headline = victimName;
    detail = isNight ? 'zginął(a) tej nocy' : 'został(a) wyrzucony(a) przez wioskę';
    accent = 'blood';
  } else if (isNight) {
    icon = '🌅';
    headline = 'Spokojna noc';
    detail = 'Nikt nie zginął';
    accent = 'safe';
  } else if (result.outcome === 'tie') {
    icon = '⚖️';
    headline = 'Remis';
    detail = 'Nikt nie odpada';
    accent = 'neutral';
  } else if (result.outcome === 'vote_skipped') {
    icon = '⏭️';
    headline = 'Głosowanie pominięte';
    detail = 'Nikt nie odpada';
    accent = 'neutral';
  } else {
    icon = '⚖️';
    headline = 'Brak rozstrzygnięcia';
    detail = 'Nikt nie odpada';
    accent = 'neutral';
  }

  const accentClasses = {
    blood: { text: 'text-blood', ring: 'ring-blood/40', glow: 'bg-blood/20' },
    safe: { text: 'text-safe', ring: 'ring-safe/30', glow: 'bg-safe/15' },
    neutral: { text: 'text-white', ring: 'ring-white/20', glow: 'bg-white/10' },
  }[accent];

  const waitingLabel = isNight
    ? 'Master zaraz rozpocznie dyskusję…'
    : 'Master zaraz rozpocznie kolejną rundę…';

  return (
    <div className="h-full flex flex-col items-center justify-center px-6 gap-5 text-center animate-reveal-in">
      <p className="text-white/35 text-xs uppercase tracking-[0.3em]">{eyebrow}</p>

      {/* Ikona / avatar ofiary */}
      <div className="relative">
        <div className={`absolute -inset-6 rounded-full blur-2xl ${accentClasses.glow}`} />
        {victim?.avatarUrl ? (
          <img
            src={victim.avatarUrl}
            alt=""
            className={`relative w-24 h-24 rounded-full object-cover ring-4 ${accentClasses.ring} grayscale opacity-70`}
            draggable={false}
          />
        ) : (
          <span className="relative block text-6xl leading-none">{icon}</span>
        )}
      </div>

      <div className="space-y-2">
        <h1 className={`font-display text-4xl sm:text-5xl font-bold ${accentClasses.text}`}>
          {headline}
        </h1>
        <p className="text-white/60 text-base">{detail}</p>
        {isMe && (
          <p className="text-blood/90 text-sm font-semibold uppercase tracking-wider">
            To Ty — odpadasz z gry
          </p>
        )}
      </div>

      {/* Master kończy fazę przyciskiem; gracze czekają */}
      {onAdvance ? (
        <div className="w-full max-w-xs flex flex-col items-center">
          <AdvanceButton onAdvance={onAdvance} label={advanceLabel} />
          {onEndGame && (
            <button
              type="button"
              onClick={onEndGame}
              className="mt-3 text-xs text-blood/80 hover:text-blood underline-offset-2 hover:underline py-1"
            >
              Zakończ rozgrywkę
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 mt-2">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </div>
          <p className="text-white/35 text-xs">{waitingLabel}</p>
        </div>
      )}
    </div>
  );
}

function AdvanceButton({ onAdvance, label }) {
  const [advancing, setAdvancing] = useState(false);

  async function handleClick() {
    if (advancing) return;
    setAdvancing(true);
    try {
      await onAdvance();
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={advancing}
      className="btn-primary mt-4 w-full max-w-xs"
    >
      {advancing ? 'Przechodzenie…' : label}
    </button>
  );
}
