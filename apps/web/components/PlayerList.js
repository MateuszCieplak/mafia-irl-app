'use client';

import { ROLE_LABELS, ROLE_COLORS } from '@/lib/roleTheme';

function labelForPlayer(player) {
  const raw = (player.username || '').trim();
  if (!raw) return player.id?.slice(0, 8) || '?';
  if (raw.includes('@')) return raw.split('@')[0] || raw.slice(0, 8);
  return raw;
}

function PlayerAvatar({ player, size = 'w-10 h-10', showPresence, online }) {
  const initial = labelForPlayer(player)[0].toUpperCase();
  return (
    <div className={`relative ${size} shrink-0`}>
      {player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.avatarUrl}
          alt=""
          className={`${size} rounded-full object-cover ring-1 ring-white/20`}
        />
      ) : (
        <div
          className={`${size} rounded-full bg-white/10 flex items-center justify-center text-sm font-bold ring-1 ring-white/10`}
        >
          {initial}
        </div>
      )}
      {showPresence && (
        <span
          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-night ${
            online ? 'bg-emerald-400' : 'bg-white/25'
          }`}
          aria-hidden
        />
      )}
    </div>
  );
}

export default function PlayerList({
  players,
  showRoles = false,
  onSelect,
  selectedId,
  selectable = false,
  showPresence = false,
  masterCanKick = false,
  currentUserId,
  onKickPlayer,
  gridLayout = false,
  doctorBlockedId = null,
  // { [playerId]: ['Ty', 'Janek'] } — znaczniki głosów mafii przy wskazanym celu.
  voteMarkers = null,
  // Master: gracz zabity przez mafię — animacja na jego karcie (gridLayout).
  highlightKilledId = null,
  // Master, faza głosowania: { [playerId]: czas } — karta pokazuje „głosuje…” / „zagłosował(a)”.
  votingStatus = null,
  // Master w lobby: { [playerId]: rola | '' } — pod nazwą pokazujemy przypisaną rolę.
  roleHints = null,
}) {
  if (gridLayout) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {players.map((player) => {
          const isEliminated = player.eliminated;
          const online = showPresence ? player.online !== false : true;
          const showKick =
            masterCanKick &&
            onKickPlayer &&
            !player.isMaster &&
            currentUserId &&
            player.id !== currentUserId;

          const justKilled = Boolean(highlightKilledId) && player.id === highlightKilledId;
          const isVoter = Boolean(votingStatus) && !player.isMaster && !isEliminated;
          const hasVoted = isVoter && Boolean(votingStatus[player.id]);

          return (
            <div
              key={player.id}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-center transition
                ${justKilled ? 'animate-kill-pulse ring-2 ring-blood/70' : ''}
                ${isEliminated ? 'opacity-30 line-through border-white/5' : 'border-white/10 bg-white/[0.04]'}
                ${showPresence && !online && !isEliminated ? 'opacity-60' : ''}
                ${hasVoted ? '!border-emerald-400/70 bg-emerald-500/10' : ''}
              `}
            >
              {justKilled && (
                <span className="absolute -top-2 -right-2 text-xl animate-scale-in" aria-hidden>
                  💀
                </span>
              )}
              <PlayerAvatar player={player} showPresence={showPresence} online={online} />

              <span className={`text-sm font-medium truncate w-full ${showPresence && !online ? 'text-white/45' : ''}`}>
                {labelForPlayer(player)}
              </span>

              {roleHints && !player.isMaster && (
                <span
                  className={`text-[12px] font-semibold uppercase tracking-wide ${
                    roleHints[player.id] ? ROLE_COLORS[roleHints[player.id]] || '' : 'text-white/35'
                  }`}
                >
                  {roleHints[player.id] ? ROLE_LABELS[roleHints[player.id]] : 'Losowa'}
                </span>
              )}

              <div className="flex flex-wrap justify-center gap-1">
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
                {isEliminated && (
                  <span className="text-[12px] text-white/30">wyeliminowany</span>
                )}
              </div>

              {showRoles && player.role && (
                <span className={`text-xs ${ROLE_COLORS[player.role] || ''}`}>
                  {ROLE_LABELS[player.role] || player.role}
                </span>
              )}

              {isVoter && (
                <span
                  className={`text-[12px] font-semibold ${
                    hasVoted ? 'text-emerald-300' : 'text-white/40 animate-pulse'
                  }`}
                >
                  {hasVoted ? '✓ zagłosował(a)' : 'głosuje…'}
                </span>
              )}

              {showPresence && (
                <span className="text-[12px] text-white/35">
                  {online ? 'online' : 'offline'}
                </span>
              )}

              {showKick && (
                <button
                  type="button"
                  onClick={() => onKickPlayer(player.id)}
                  className="btn-secondary text-[12px] px-2 py-1 mt-0.5 w-full"
                >
                  Usuń
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {players.map((player) => {
        const isEliminated = player.eliminated;
        const isDoctorBlocked = doctorBlockedId && player.id === doctorBlockedId;
        const isSelected = player.id === selectedId;
        const canSelect = selectable && !isEliminated && !isDoctorBlocked;
        const online = showPresence ? player.online !== false : true;
        const showKick =
          masterCanKick &&
          onKickPlayer &&
          !player.isMaster &&
          currentUserId &&
          player.id !== currentUserId;

        const rowInner = (
          <>
            <PlayerAvatar
              player={player}
              size="w-8 h-8"
              showPresence={showPresence}
              online={online}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`truncate font-medium text-sm ${showPresence && !online ? 'text-white/45' : ''}`}
                >
                  {labelForPlayer(player)}
                </span>
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
              </div>
              {showRoles && player.role && (
                <span className={`text-xs ${ROLE_COLORS[player.role] || ''}`}>
                  {ROLE_LABELS[player.role] || player.role}
                </span>
              )}
              {voteMarkers?.[player.id]?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {voteMarkers[player.id].map((label, i) => (
                    <span
                      key={`${label}-${i}`}
                      className="text-[12px] bg-blood/25 text-paper-100 px-1.5 py-0.5 rounded-full"
                    >
                      🎯 {label}
                    </span>
                  ))}
                </div>
              )}
              {isDoctorBlocked && (
                <span className="text-[12px] text-white/35 block">Leczony ostatnio</span>
              )}
              {showPresence ? (
                <span className="text-[12px] text-white/35 block mt-0.5">
                  {online ? 'W grze (online)' : 'Niepołączony'}
                </span>
              ) : null}
            </div>
            {isEliminated && <span className="text-xs text-white/30">wyeliminowany</span>}
            {showKick ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onKickPlayer(player.id);
                }}
                className="btn-secondary text-[12px] px-2 py-1.5 shrink-0"
              >
                Usuń
              </button>
            ) : null}
          </>
        );

        const rowClass = `w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition
              ${isEliminated || isDoctorBlocked ? 'opacity-40' : ''}
              ${showPresence && !online && !isEliminated ? 'opacity-70' : ''}
              ${canSelect ? 'hover:bg-white/10 active:bg-white/15' : ''}
              ${isSelected ? 'bg-white/15 ring-1 ring-white/30' : ''}
              ${!canSelect && !isEliminated ? 'cursor-default' : ''}
            `;

        if (canSelect) {
          return (
            <button
              key={player.id}
              type="button"
              onClick={() => onSelect?.(player.id)}
              className={rowClass}
            >
              {rowInner}
            </button>
          );
        }

        return (
          <div key={player.id} className={rowClass}>
            {rowInner}
          </div>
        );
      })}
    </div>
  );
}
