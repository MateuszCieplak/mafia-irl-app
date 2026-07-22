'use client';

import { useState } from 'react';
import PlayerList from './PlayerList';

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

export default function NightActionPicker({ role, players, onSubmit, disabled, result, lastDoctorTarget }) {
  const [selectedId, setSelectedId] = useState(null);
  const info = ACTION_INFO[role];

  if (!info) return null;

  function handleConfirm() {
    if (selectedId) {
      onSubmit(selectedId);
    }
  }

  return (
    <div className="card space-y-3">
      <h3 className="font-display font-bold text-lg">{info.title}</h3>
      <p className="text-white/50 text-sm">{info.description}</p>

      {result !== undefined && role === 'detective' && (
        <div className={`rounded-xl p-3 text-sm font-semibold ${result?.is_mafia ? 'bg-red-900/30 text-blood' : 'bg-green-900/30 text-safe'}`}>
          {result?.is_mafia ? 'Ten gracz jest mafią!' : 'Ten gracz nie jest mafią.'}
        </div>
      )}

      {!disabled && (
        <>
          <div className="max-h-[45vh] overflow-y-auto -mx-1 px-1">
            <PlayerList
              players={players}
              selectable
              selectedId={selectedId}
              onSelect={setSelectedId}
              doctorBlockedId={role === 'doctor' ? lastDoctorTarget : null}
            />
          </div>
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            className="btn-primary w-full shrink-0"
          >
            {info.actionLabel}
          </button>
        </>
      )}

      {disabled && !result && (
        <p className="text-white/30 text-sm text-center py-2">Akcja złożona</p>
      )}
    </div>
  );
}
