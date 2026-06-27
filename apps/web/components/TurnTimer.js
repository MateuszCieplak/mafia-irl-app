'use client';

import { useEffect, useState } from 'react';

function formatRemaining(ms) {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function TurnTimer({ phaseDeadline, phase }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!phaseDeadline) {
      setRemaining(null);
      return;
    }

    function tick() {
      setRemaining(Math.max(0, phaseDeadline - Date.now()));
    }
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phaseDeadline, phase]);

  if (remaining === null) return null;

  const urgent = remaining < 15000;

  return (
    <span
      className={`font-mono text-lg tabular-nums ${urgent ? 'text-blood animate-pulse' : 'text-white/80'}`}
    >
      {formatRemaining(remaining)}
    </span>
  );
}
