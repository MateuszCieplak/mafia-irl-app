'use client';

import { useEffect, useState } from 'react';
import PlayerList from './PlayerList';
import { useTransient } from '@/lib/useTransient';

const ACTION_INFO = {
  detective: {
    title: 'Zbadaj gracza',
    description: 'Wybierz gracza, żeby sprawdzić, czy jest mafią',
    actionLabel: 'Zbadaj',
  },
  doctor: {
    title: 'Ochroń gracza',
    description: 'Wybierz gracza, którego chcesz ochronić tej nocy',
    actionLabel: 'Ochroń',
  },
  mafia: {
    title: 'Wybierz cel',
    description: 'Wybierz gracza do eliminacji (wszyscy mafiosi muszą wybrać tego samego)',
    actionLabel: 'Zatwierdź',
  },
};

/**
 * Zwięzła lista głosów mafii: „Janek → Ola”, „Ty → Ola”, „Piotr — jeszcze nie zagłosował”.
 * `teammateIds` (opcjonalne) pozwala wypisać też tych, którzy jeszcze nie zagłosowali;
 * bez niego pokazujemy wyłącznie oddane głosy.
 */
export function MafiaVotesSummary({
  votes,
  currentUserId,
  teammateIds,
  nameOf,
  className = '',
}) {
  const entries = Object.entries(votes || {});
  const pending = Array.isArray(teammateIds)
    ? teammateIds.filter((id) => !(id in (votes || {})))
    : [];
  const myVoted = currentUserId && currentUserId in (votes || {});
  const meMissing = Array.isArray(teammateIds) && currentUserId && !myVoted ? [currentUserId] : [];
  const waiting = [...meMissing, ...pending.filter((id) => id !== currentUserId)];

  // Wszyscy mafiosi zagłosowali na tego samego gracza → jedno zdanie zamiast listy głosów.
  const required = new Set([...(Array.isArray(teammateIds) ? teammateIds : []), currentUserId].filter(Boolean));
  const targets = new Set(entries.map(([, t]) => t));
  const unanimous =
    Array.isArray(teammateIds) &&
    entries.length > 0 &&
    waiting.length === 0 &&
    [...required].every((id) => id in (votes || {})) &&
    targets.size === 1;
  // „Mafia strzela w …” pojawia się tylko na chwilę po jednomyślnej decyzji —
  // po odblokowaniu ekranu nie wisi na stałe.
  const unanimousVisible = useTransient(unanimous ? [...targets][0] : null, 6000);

  if (entries.length === 0 && waiting.length === 0) {
    return (
      <p className={`text-xs text-white/40 ${className}`}>Głosy mafii: nikt jeszcze nie zagłosował</p>
    );
  }

  if (unanimous) {
    if (!unanimousVisible) return null;
    return (
      <div className={`text-xs space-y-0.5 ${className}`}>
        <p className="text-white/40 uppercase tracking-wider text-[12px]">Głosy mafii</p>
        <p className="text-blood font-semibold text-sm">Mafia strzela w {nameOf([...targets][0])}</p>
      </div>
    );
  }

  const label = (id) => (id === currentUserId ? 'Ty' : nameOf(id));

  return (
    <div className={`text-xs text-white/70 space-y-0.5 ${className}`}>
      <p className="text-white/40 uppercase tracking-wider text-[12px]">Głosy mafii</p>
      <ul className="space-y-0.5">
        {entries.map(([mafiosoId, targetId]) => (
          <li key={mafiosoId}>
            <span className="font-semibold">{label(mafiosoId)}</span> → {nameOf(targetId)}
          </li>
        ))}
        {waiting.map((id) => (
          <li key={`w-${id}`} className="text-white/40">
            {label(id)} — {id === currentUserId ? 'jeszcze nie zagłosowałeś(aś)' : 'jeszcze nie zagłosował'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function NightActionPicker({
  role,
  players,
  onSubmit,
  disabled,
  result,
  doctorBlockedId = null,
  // Tylko mafia:
  mafiaVotes = null,
  mafiaTeammateIds = null,
  currentUserId = null,
  onRetract = null,
}) {
  const info = ACTION_INFO[role];
  const isMafia = role === 'mafia';
  // Wynik śledztwa tylko chwilowo; stały zapis jest w dzienniku detektywa.
  const verdictVisible = useTransient(
    role === 'detective' && result !== undefined ? `r:${String(result?.is_mafia)}` : null,
    8000,
  );
  const myVote = isMafia && currentUserId ? mafiaVotes?.[currentUserId] ?? null : null;
  const [selectedId, setSelectedId] = useState(myVote);
  const [retracting, setRetracting] = useState(false);

  // Zmiana własnego głosu (np. po resyncu / cofnięciu) odświeża zaznaczenie.
  useEffect(() => {
    if (isMafia) setSelectedId(myVote);
  }, [isMafia, myVote]);

  if (!info) return null;

  const nameOf = (id) => players.find((p) => p.id === id)?.username || '—';
  // Mafia może zmieniać głos także po złożeniu — picker zostaje aktywny.
  const locked = isMafia ? false : disabled;

  const voteMarkers = {};
  if (isMafia && mafiaVotes) {
    for (const [mafiosoId, targetId] of Object.entries(mafiaVotes)) {
      const label = mafiosoId === currentUserId ? 'Ty' : nameOf(mafiosoId);
      (voteMarkers[targetId] ||= []).push(label);
    }
  }

  function handleConfirm() {
    if (selectedId) {
      onSubmit(selectedId);
    }
  }

  async function handleRetract() {
    if (!onRetract || retracting) return;
    setRetracting(true);
    try {
      await onRetract();
    } finally {
      setRetracting(false);
    }
  }

  const confirmLabel = isMafia && myVote ? 'Zmień głos' : info.actionLabel;
  const unchanged = isMafia && myVote && selectedId === myVote;
  // Detektyw po sprawdzeniu: blok pokazuje tylko wynik śledztwa.
  const showVerdict = role === 'detective' && result !== undefined && verdictVisible;

  return (
    <div className="card flex flex-col gap-3 min-h-0 max-h-full">
      <h3 className="font-display font-bold text-lg">
        {showVerdict ? 'Wynik śledztwa' : info.title}
      </h3>
      {!showVerdict && <p className="text-white/50 text-sm">{info.description}</p>}

      {showVerdict && (
        <div className={`rounded-xl p-3 text-sm font-semibold ${result?.is_mafia ? 'bg-red-900/30 text-blood' : 'bg-green-900/30 text-safe'}`}>
          {result?.is_mafia ? 'Ten gracz jest mafią!' : 'Ten gracz nie jest mafią.'}
        </div>
      )}

      {isMafia && (
        <MafiaVotesSummary
          votes={mafiaVotes}
          currentUserId={currentUserId}
          teammateIds={mafiaTeammateIds}
          nameOf={nameOf}
        />
      )}

      {!locked && !showVerdict && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 stagger-deep [--stagger-step:35ms]">
            <PlayerList
              players={players}
              selectable
              selectedId={selectedId}
              onSelect={setSelectedId}
              doctorBlockedId={role === 'doctor' ? doctorBlockedId : null}
              voteMarkers={isMafia ? voteMarkers : null}
            />
          </div>
          <button
            onClick={handleConfirm}
            disabled={!selectedId || unchanged}
            className="btn-primary w-full shrink-0"
          >
            {confirmLabel}
          </button>
          {isMafia && myVote && onRetract && (
            <button
              type="button"
              onClick={handleRetract}
              disabled={retracting}
              className="btn-ghost w-full shrink-0"
            >
              {retracting ? 'Cofam…' : 'Cofnij głos'}
            </button>
          )}
        </>
      )}

      {locked && !showVerdict && (
        <p className="text-white/30 text-sm text-center py-2">
          Akcja złożona{role === 'detective' ? ' — wynik w dzienniku' : ''}
        </p>
      )}
    </div>
  );
}
