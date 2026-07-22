'use client';

import { useState } from 'react';
import PlayerList from './PlayerList';

export default function VotePanel({ players, onVote, disabled }) {
  const [selectedId, setSelectedId] = useState(null);

  function handleVote() {
    onVote(selectedId);
  }

  function handleSkip() {
    onVote(null);
  }

  if (disabled) {
    return (
      <div className="card">
        <p className="text-white/40 text-sm text-center">Głos oddany</p>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <h3 className="font-display font-bold text-lg">Głosowanie</h3>
      <p className="text-white/50 text-sm">Wybierz gracza do eliminacji lub pomiń głosowanie</p>

      <div className="max-h-[45vh] overflow-y-auto -mx-1 px-1">
        <PlayerList
          players={players}
          selectable
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      <div className="flex gap-2 shrink-0">
        <button onClick={handleSkip} className="btn-secondary flex-1">
          Pomiń
        </button>
        <button onClick={handleVote} disabled={!selectedId} className="btn-primary flex-1">
          Głosuj
        </button>
      </div>
    </div>
  );
}
