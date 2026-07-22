'use client';

import { useState, useEffect } from 'react';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/roleTheme';

function labelForPlayer(player) {
  const raw = (player.username || '').trim();
  if (!raw) return player.id?.slice(0, 8) || '?';
  if (raw.includes('@')) return raw.split('@')[0] || raw.slice(0, 8);
  return raw;
}

function PlayerAvatar({ player, size = 'w-10 h-10' }) {
  const initial = labelForPlayer(player)[0].toUpperCase();
  if (player.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.avatarUrl}
        alt=""
        className={`${size} rounded-full object-cover ring-1 ring-white/20`}
      />
    );
  }
  return (
    <div
      className={`${size} rounded-full bg-white/10 flex items-center justify-center text-sm font-bold ring-1 ring-white/10`}
    >
      {initial}
    </div>
  );
}

export default function RolePlayerList({
  players,
  role,
  detectiveHistory = [],
  lastDoctorTarget,
  roomCode,
  showRoles = false,
  recentlyEliminatedId,
}) {
  const notesKey = `mafia_role_notes_${roomCode}`;
  const [notes, setNotes] = useState({});

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        setNotes(JSON.parse(localStorage.getItem(notesKey) || '{}'));
      } catch {
        setNotes({});
      }
    }
  }, [notesKey]);

  const investigatedMap = new Map(
    detectiveHistory.map((h) => [h.targetId, h.result?.is_mafia]),
  );

  function setNoteForPlayer(playerId, noteRole) {
    const next = { ...notes, [playerId]: noteRole };
    setNotes(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(notesKey, JSON.stringify(next));
    }
  }

  return (
    <div className="space-y-3">
      {role === 'detective' && detectiveHistory.length > 0 && (
        <p className="text-[12px] text-white/40 leading-relaxed">
          🔍 Sprawdziłeś(aś) {detectiveHistory.length}{' '}
          {detectiveHistory.length === 1 ? 'osobę' : 'osoby'} — wynik widoczny przy graczu.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
      {players.map((player) => {
        const isEliminated = player.eliminated;
        const justKilled = player.id === recentlyEliminatedId;
        const investigated = investigatedMap.has(player.id);
        const isMafia = investigatedMap.get(player.id);

        return (
          <div
            key={player.id}
            className={`flex flex-col gap-1.5 rounded-xl border px-3 py-3 text-center transition
              ${isEliminated ? 'opacity-35 line-through border-white/5' : 'border-white/10 bg-white/[0.04]'}
              ${justKilled ? 'animate-kill-pulse border-blood/50' : ''}
            `}
          >
            <div className="flex justify-center">
              <PlayerAvatar player={player} />
            </div>

            <span className="text-sm font-medium truncate w-full">{labelForPlayer(player)}</span>

            <div className="flex flex-wrap justify-center gap-1 min-h-[18px]">
              {player.isMaster && (
                <span className="text-[12px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
                  HOST
                </span>
              )}
              {player.isBot && (
                <span className="text-[12px] font-mono bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                  BOT
                </span>
              )}
              {showRoles && player.role && (
                <span className={`text-[12px] capitalize ${ROLE_COLORS[player.role] || ''}`}>
                  {ROLE_LABELS[player.role] || player.role}
                </span>
              )}
            </div>

            {role === 'detective' && investigated && (
              <span
                className={`text-[12px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                  isMafia
                    ? 'bg-red-500/20 text-role-mafia'
                    : 'bg-emerald-500/20 text-role-detective'
                }`}
              >
                🔍 {isMafia ? 'Mafia' : 'Nie mafia'}
              </span>
            )}

            {role === 'doctor' && lastDoctorTarget === player.id && (
              <span className="text-[12px] text-role-doctor font-medium">Uleczony ostatnio</span>
            )}

            {role === 'citizen' && !player.isMaster && (
              <select
                className="text-[12px] bg-white/5 border border-white/10 rounded-lg px-1 py-1 text-white/70 w-full"
                value={notes[player.id] || ''}
                onChange={(e) => setNoteForPlayer(player.id, e.target.value)}
              >
                <option value="">Notatka roli…</option>
                <option value="mafia">Mafia</option>
                <option value="detective">Detektyw</option>
                <option value="doctor">Lekarz</option>
                <option value="citizen">Obywatel</option>
              </select>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

export { PlayerAvatar, labelForPlayer };
