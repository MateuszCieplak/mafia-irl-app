'use client';

import { useEffect, useState } from 'react';
import PlayerList from './PlayerList';

export default function VotePanel({
  players,
  onVote,
  onRetract = null,
  hasVoted = false,
  myVoteTarget = null,
}) {
  const [selectedId, setSelectedId] = useState(myVoteTarget);
  const [retracting, setRetracting] = useState(false);

  // Po resyncu / cofnięciu zaznaczenie wraca do aktualnego głosu.
  useEffect(() => {
    setSelectedId(myVoteTarget);
  }, [myVoteTarget]);

  const skipped = hasVoted && !myVoteTarget;
  // „Zmień głos” aktywne dopiero po wybraniu innego gracza niż obecny.
  const unchanged = hasVoted && selectedId === myVoteTarget;

  function handleVote() {
    onVote(selectedId);
  }

  function handleSkip() {
    onVote(null);
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

  return (
    <div className="card flex flex-col gap-3 min-h-0 max-h-full">
      <h3 className="font-display font-bold text-lg">Głosowanie</h3>
      <p className="text-white/50 text-sm">
        {hasVoted
          ? skipped
            ? 'Pominąłeś(aś) głosowanie. Możesz zmienić decyzję.'
            : 'Głos oddany. Możesz go zmienić albo cofnąć.'
          : 'Wybierz gracza do eliminacji lub pomiń głosowanie'}
      </p>

      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 stagger-deep [--stagger-step:35ms]">
        <PlayerList
          players={players}
          selectable
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      <div className="flex gap-2 shrink-0">
        <button
          onClick={handleSkip}
          disabled={skipped}
          className="btn-secondary flex-1"
        >
          Pomiń
        </button>
        <button
          onClick={handleVote}
          disabled={!selectedId || unchanged}
          className="btn-primary flex-1"
        >
          {hasVoted ? 'Zmień głos' : 'Głosuj'}
        </button>
      </div>

      {hasVoted && onRetract && (
        <button
          type="button"
          onClick={handleRetract}
          disabled={retracting}
          className="btn-ghost w-full shrink-0"
        >
          {retracting ? 'Cofam…' : 'Cofnij głos'}
        </button>
      )}
    </div>
  );
}
