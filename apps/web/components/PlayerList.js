'use client';

const ROLE_COLORS = {
  mafia: 'text-blood',
  doctor: 'text-safe',
  detective: 'text-blue-400',
  citizen: 'text-white/70',
};

/** Widoczna nazwa: nigdy pełny email (np. stary stan z serwera). */
function labelForPlayer(player) {
  const raw = (player.username || '').trim();
  if (!raw) return player.id?.slice(0, 8) || '?';
  if (raw.includes('@')) return raw.split('@')[0] || raw.slice(0, 8);
  return raw;
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
}) {
  if (gridLayout) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {players.map((player) => {
          const isEliminated = player.eliminated;
          const online = showPresence ? player.online !== false : true;
          const showKick =
            masterCanKick &&
            onKickPlayer &&
            !player.isMaster &&
            currentUserId &&
            player.id !== currentUserId;

          return (
            <div
              key={player.id}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-center transition
                ${isEliminated ? 'opacity-30 line-through border-white/5' : 'border-white/10 bg-white/[0.04]'}
                ${showPresence && !online && !isEliminated ? 'opacity-60' : ''}
              `}
            >
              <div
                className="relative w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold"
                title={showPresence ? (online ? 'Połączony' : 'Rozłączony — zamknięta przeglądarka') : undefined}
              >
                {labelForPlayer(player)[0].toUpperCase()}
                {showPresence && (
                  <span
                    className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-night ${
                      online ? 'bg-emerald-400' : 'bg-white/25'
                    }`}
                    aria-hidden
                  />
                )}
              </div>

              <span className={`text-sm font-medium truncate w-full ${showPresence && !online ? 'text-white/45' : ''}`}>
                {labelForPlayer(player)}
              </span>

              <div className="flex flex-wrap justify-center gap-1">
                {player.isMaster && (
                  <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
                    HOST
                  </span>
                )}
                {player.isBot && (
                  <span className="text-[10px] font-mono bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                    BOT
                  </span>
                )}
                {isEliminated && (
                  <span className="text-[10px] text-white/30">wyeliminowany</span>
                )}
              </div>

              {showRoles && player.role && (
                <span className={`text-xs ${ROLE_COLORS[player.role] || ''}`}>{player.role}</span>
              )}

              {showPresence && (
                <span className="text-[10px] text-white/35">
                  {online ? 'online' : 'offline'}
                </span>
              )}

              {showKick && (
                <button
                  type="button"
                  onClick={() => onKickPlayer(player.id)}
                  className="btn-secondary text-[10px] px-2 py-1 mt-0.5 w-full"
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
        const isSelected = player.id === selectedId;
        const canSelect = selectable && !isEliminated;
        const online = showPresence ? player.online !== false : true;
        const showKick =
          masterCanKick &&
          onKickPlayer &&
          !player.isMaster &&
          currentUserId &&
          player.id !== currentUserId;

        const rowInner = (
          <>
            <div
              className="relative w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0"
              title={showPresence ? (online ? 'Połączony' : 'Rozłączony — zamknięta przeglądarka') : undefined}
            >
              {labelForPlayer(player)[0].toUpperCase()}
              {showPresence ? (
                <span
                  className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-night ${
                    online ? 'bg-emerald-400' : 'bg-white/25'
                  }`}
                  aria-hidden
                />
              ) : null}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`truncate font-medium text-sm ${showPresence && !online ? 'text-white/45' : ''}`}
                >
                  {labelForPlayer(player)}
                </span>
                {player.isMaster && (
                  <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
                    HOST
                  </span>
                )}
                {player.isBot && (
                  <span className="text-[10px] font-mono bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                    BOT
                  </span>
                )}
              </div>
              {showRoles && player.role && (
                <span className={`text-xs ${ROLE_COLORS[player.role] || ''}`}>{player.role}</span>
              )}
              {showPresence ? (
                <span className="text-[10px] text-white/35 block mt-0.5">
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
                className="btn-secondary text-[10px] px-2 py-1.5 shrink-0"
              >
                Usuń
              </button>
            ) : null}
          </>
        );

        const rowClass = `w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition
              ${isEliminated ? 'opacity-30 line-through' : ''}
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
