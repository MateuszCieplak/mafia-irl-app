'use client';

import { ROLE_LABELS, ROLE_COLORS } from '@/lib/roleTheme';

const ROLE_OPTIONS = [
  { value: '', label: 'Losowo' },
  { value: 'mafia', label: 'Mafia' },
  { value: 'detective', label: 'Detektyw' },
  { value: 'doctor', label: 'Lekarz' },
  { value: 'citizen', label: 'Obywatel' },
];

function countByRole(assignments) {
  const counts = { mafia: 0, detective: 0, doctor: 0, citizen: 0 };
  for (const r of Object.values(assignments)) {
    if (r && counts[r] !== undefined) counts[r]++;
  }
  return counts;
}

export default function RoleAssignmentPanel({ players, assignments, onChange }) {
  // players = non-master participants
  const counts = countByRole(assignments);

  function setRole(playerId, role) {
    onChange({ ...assignments, [playerId]: role || undefined });
  }

  function clearAll() {
    onChange({});
  }

  const assignedCount = Object.values(assignments).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-bold text-sm text-white/70 uppercase tracking-wider">
            Przypisanie ról
          </h3>
          <p className="text-[13px] text-white/35 mt-0.5">
            Pozostawione na &quot;Losowo&quot; zostaną przydzielone automatycznie
          </p>
        </div>
        {assignedCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[13px] text-white/40 hover:text-white/70 transition-colors"
          >
            Wyczyść
          </button>
        )}
      </div>

      {/* Role count summary */}
      <div className="flex gap-2 flex-wrap">
        {[['mafia', 'text-role-mafia'], ['detective', 'text-role-detective'], ['doctor', 'text-role-doctor'], ['citizen', 'text-role-citizen']].map(([role, color]) => (
          <span key={role} className={`text-[13px] font-semibold ${color} bg-white/5 rounded-full px-2 py-0.5`}>
            {ROLE_LABELS[role]}: {counts[role]}
          </span>
        ))}
      </div>

      {/* Player list with role selects */}
      <ul className="space-y-2">
        {players.map((player) => {
          const selected = assignments[player.id] || '';
          return (
            <li
              key={player.id}
              className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2"
            >
              {/* Avatar / initial */}
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden">
                {player.avatarUrl ? (
                  <img src={player.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  (player.username || '?')[0].toUpperCase()
                )}
              </div>

              {/* Name */}
              <span className="flex-1 text-sm font-medium truncate min-w-0">
                {player.username || player.id.slice(0, 8)}
                {player.isBot && (
                  <span className="ml-1.5 text-[12px] text-white/35 font-normal">BOT</span>
                )}
              </span>

              {/* Role select */}
              <select
                value={selected}
                onChange={(e) => setRole(player.id, e.target.value)}
                className={`shrink-0 bg-white/10 border border-white/15 rounded-lg text-xs px-2 py-1 appearance-none cursor-pointer focus:outline-none focus:border-white/40 transition-colors ${
                  selected ? ROLE_COLORS[selected] : 'text-white/50'
                }`}
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-gray-900 text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>

      {players.length === 0 && (
        <p className="text-white/30 text-xs text-center py-2">
          Brak graczy do przypisania ról
        </p>
      )}
    </div>
  );
}
