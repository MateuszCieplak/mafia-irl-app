'use client';

/**
 * Ekran rozstrzygnięcia nocy / głosowania.
 *
 * Świadomie NIE jest popupem: wynik jest sterowany fazą gry (`night_resolve`,
 * `day_resolve`), a nie momentem dotarcia eventu. Gracz, którego telefon spał,
 * gdy master rozstrzygał noc, po odblokowaniu ekranu nadal widzi ten ekran —
 * znika dopiero, gdy master ręcznie przejdzie do dyskusji / kolejnej rundy.
 */
export default function PhaseResultScreen({ result, players, currentUserId, round }) {
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

      {/* Oczekiwanie na mastera */}
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
    </div>
  );
}
