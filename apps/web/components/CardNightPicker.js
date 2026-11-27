'use client';

import { useState } from 'react';
import { CARD_INFO, mafiaCountLabel, roleLabelPl } from '@/lib/cards';
import { PlayerAvatar, labelForPlayer } from '@/components/RolePlayerList';

const TITLES = {
  check: 'Sprawdzenie',
  reveal: 'Odkrycie',
  alibi: 'Alibi',
  false_lead: 'Fałszywy trop',
  jam: 'Zakłócenie',
};

const PROMPTS = {
  check: (n) => `Wybierz ${n} ${n === 1 ? 'gracza' : 'graczy'} — dowiesz się, ilu z nich to mafia.`,
  reveal: () => 'Wybierz dowolnego żywego gracza — dowiesz się, jaką ma rolę.',
  alibi: () => 'Wybierz mafiozę, który ma wyglądać na „czystego” przy najbliższym Sprawdzeniu.',
  false_lead: () => 'Wybierz niewinnego gracza, który ma wyglądać na mafię przy najbliższym Sprawdzeniu.',
  jam: () => 'Potwierdź aktywację — następne Sprawdzenie obywatela pokaże błędny wynik.',
};

/**
 * Nocna tura karty: Sprawdzenie obywatela (wybór trójki) albo karta mafii
 * (Alibi / Fałszywy trop / Zakłócenie). Wynik Sprawdzenia widzi tylko ten gracz.
 */
export default function CardNightPicker({ prompt, players, onSubmit, result, error }) {
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const type = prompt?.type;
  const info = CARD_INFO[type];
  if (!info) return null;

  const candidates = (prompt.candidates || [])
    .map((id) => players.find((p) => p.id === id))
    .filter(Boolean);
  const need = type === 'check' ? prompt.targetCount ?? 3 : type === 'jam' ? 0 : 1;
  const done = Boolean(result);
  const ready = selected.length === need;

  function toggle(id) {
    if (done) return;
    setSelected((prev) => {
      if (need === 1) return [id];
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return prev.length >= need ? prev : [...prev, id];
    });
  }

  async function handleSubmit() {
    if (!ready || busy || done) return;
    setBusy(true);
    try {
      await onSubmit(type === 'check' ? { targetIds: selected } : { targetId: selected[0] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-3 min-h-0 max-h-full">
      <h3 className="font-display font-bold text-lg">
        <span aria-hidden>{info.icon}</span> {TITLES[type]}
      </h3>
      <p className="text-white/50 text-sm">{PROMPTS[type](need)}</p>

      {done && type === 'check' && (
        <div className="rounded-xl p-3 text-sm font-semibold bg-white/10 text-white">
          W tej grupie: {mafiaCountLabel(result.count)}
          <p className="text-xs font-normal text-white/50 mt-1">
            Zapisaliśmy to w menu → Karty mocy, a przy sprawdzonych graczach pojawi się znacznik.
          </p>
        </div>
      )}
      {done && type === 'reveal' && (
        <div className="rounded-xl p-3 text-sm font-semibold bg-white/10 text-white">
          {candidates.find((p) => p.id === result.targetId) ? labelForPlayer(candidates.find((p) => p.id === result.targetId)) : 'Ten gracz'}
          : {roleLabelPl(result.role)}
          <p className="text-xs font-normal text-white/50 mt-1">Zapisaliśmy to w menu → Karty mocy.</p>
        </div>
      )}
      {done && type !== 'check' && type !== 'reveal' && (
        <p className="rounded-xl p-3 text-sm bg-emerald-900/30 text-safe">Karta aktywowana.</p>
      )}
      {error && <p className="rounded-lg px-3 py-2 text-sm bg-flame-500/30 text-paper-100">⚠ {error}</p>}

      {!done && need > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-1">
          {candidates.map((p) => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  on ? 'bg-white/15 ring-1 ring-white/30' : 'hover:bg-white/10'
                }`}
              >
                <PlayerAvatar player={p} size="w-8 h-8" />
                <span className="flex-1 truncate text-sm font-medium">{labelForPlayer(p)}</span>
                {on && <span aria-hidden>✓</span>}
              </button>
            );
          })}
          {type === 'check' && (
            <p className="text-[12px] text-white/40 px-1 pt-1">
              Wybrano {selected.length} z {need}
            </p>
          )}
        </div>
      )}

      {!done && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!ready || busy}
          className="btn-primary w-full shrink-0"
        >
          {busy ? 'Wysyłam…' : type === 'check' ? 'Sprawdź' : 'Aktywuj'}
        </button>
      )}
    </div>
  );
}
