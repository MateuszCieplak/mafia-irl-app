'use client';

import { useState, useEffect } from 'react';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/roleTheme';
import { buildCheckTags, mafiaCountLabel } from '@/lib/cards';

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
  cardLog = [],
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

  const checkTags = buildCheckTags(cardLog);
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

  const visiblePlayers = players.filter((p) => !p.isMaster);
  const master = players.find((p) => p.isMaster);
  const aliveCount = visiblePlayers.filter((p) => !p.eliminated).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[12px] uppercase tracking-wider text-white/40">
        <span>Żywi: {aliveCount} / {visiblePlayers.length}</span>
        {master && <span>Master: {labelForPlayer(master)}</span>}
      </div>

      {role === 'detective' && detectiveHistory.length > 0 && (
        <p className="text-[12px] text-white/40 leading-relaxed">
          🔍 Sprawdziłeś(aś) {detectiveHistory.length}{' '}
          {detectiveHistory.length === 1 ? 'osobę' : 'osoby'} — wynik widoczny przy graczu.
        </p>
      )}

      <ul className="space-y-1.5">
        {visiblePlayers.map((player) => {
          const isEliminated = player.eliminated;
          const justKilled = player.id === recentlyEliminatedId;
          const investigated = investigatedMap.has(player.id);
          const isMafia = investigatedMap.get(player.id);

          return (
            <li
              key={player.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                isEliminated ? 'border-white/5 bg-white/[0.02]' : 'border-white/10 bg-white/[0.04]'
              } ${justKilled ? 'animate-kill-pulse border-blood/50' : ''}`}
            >
              <div className={isEliminated ? 'opacity-40 grayscale' : ''}>
                <PlayerAvatar player={player} size="w-9 h-9" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`truncate text-sm font-medium ${
                      isEliminated ? 'line-through text-white/35' : ''
                    }`}
                  >
                    {labelForPlayer(player)}
                  </span>
                  {player.isBot && (
                    <span className="text-[12px] font-mono bg-purple-500/20 text-purple-300 px-1.5 rounded-full">
                      BOT
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                  {showRoles && player.role && (
                    <span className={`text-[12px] ${ROLE_COLORS[player.role] || ''}`}>
                      {ROLE_LABELS[player.role] || player.role}
                    </span>
                  )}
                  {role === 'detective' && investigated && (
                    <span
                      className={`text-[12px] font-bold uppercase tracking-wide px-1.5 rounded-full ${
                        isMafia
                          ? 'bg-red-500/20 text-role-mafia'
                          : 'bg-emerald-500/20 text-role-detective'
                      }`}
                    >
                      🔍 {isMafia ? 'Mafia' : 'Nie mafia'}
                    </span>
                  )}
                  {(checkTags[player.id] || []).map((t, i) => (
                    <span
                      key={`${t.round}-${i}`}
                      className={`text-[12px] font-bold uppercase tracking-wide px-1.5 rounded-full ${
                        t.count === 0
                          ? 'bg-emerald-500/20 text-role-detective'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                      title={`Sprawdzenie w rundzie ${t.round}: ${mafiaCountLabel(t.count)} w grupie ${t.total} osób`}
                    >
                      🔎 {t.count === 0 ? 'Czysty' : 'Podejrzany'}: {mafiaCountLabel(t.count)}
                    </span>
                  ))}
                  {role === 'doctor' && lastDoctorTarget === player.id && (
                    <span className="text-[12px] text-role-doctor font-medium">Uleczony ostatnio</span>
                  )}
                </div>
              </div>

              {role === 'citizen' && !isEliminated ? (
                <select
                  className="shrink-0 text-[12px] bg-white/5 border border-white/10 rounded-lg px-1.5 py-1 text-white/70 max-w-[7.5rem]"
                  value={notes[player.id] || ''}
                  onChange={(e) => setNoteForPlayer(player.id, e.target.value)}
                  aria-label={`Notatka o graczu ${labelForPlayer(player)}`}
                >
                  <option value="">Notatka…</option>
                  <option value="mafia">Mafia</option>
                  <option value="detective">Detektyw</option>
                  <option value="doctor">Lekarz</option>
                  <option value="citizen">Obywatel</option>
                </select>
              ) : (
                <span
                  className={`shrink-0 text-[12px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                    isEliminated ? 'bg-white/10 text-white/40' : 'bg-emerald-500/15 text-emerald-300'
                  }`}
                >
                  {isEliminated ? '💀 Odpadł' : 'Żyje'}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { PlayerAvatar, labelForPlayer };
