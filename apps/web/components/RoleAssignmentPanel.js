'use client';

import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/roleTheme';
import { LIMIT_MESSAGES } from '@/lib/roleLimits';

const ROLE_OPTIONS = [
  { value: '', label: 'Losowo' },
  { value: 'mafia', label: 'Mafia' },
  { value: 'detective', label: 'Detektyw' },
  { value: 'doctor', label: 'Lekarz' },
  { value: 'citizen', label: 'Obywatel' },
];

function countByRole(assignments, playerIds) {
  const counts = { mafia: 0, detective: 0, doctor: 0, citizen: 0 };
  for (const id of playerIds) {
    const r = assignments[id];
    if (r && counts[r] !== undefined) counts[r]++;
  }
  return counts;
}

/** Ikona „i” — po najechaniu (lub fokusie / tapnięciu) pokazuje komunikat. */
function InfoHint({ text }) {
  return (
    <span className="group/hint relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/40 text-[12px] font-bold italic leading-none text-white/60 hover:text-white focus:outline-none focus-visible:border-white"
        onClick={(e) => e.stopPropagation()}
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-[70] mb-1.5 hidden w-52 rounded-lg border border-white/15 bg-ink-900 px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug text-paper-100 shadow-xl group-hover/hint:block group-focus-within/hint:block"
      >
        {text}
      </span>
    </span>
  );
}

function RoleSelect({ value, onChange, disabledRoles }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = ROLE_OPTIONS.find((o) => o.value === value) || ROLE_OPTIONS[0];

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-w-[7.5rem] items-center justify-between gap-2 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs transition-colors hover:border-white/40 focus:outline-none focus-visible:border-white/60 ${
          value ? ROLE_COLORS[value] : 'text-white/50'
        }`}
      >
        <span>{current.label}</span>
        <span aria-hidden className={`text-[12px] text-white/40 transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-[65] mt-1 w-48 rounded-xl border border-white/15 bg-ink-900 p-1 shadow-2xl animate-fade-in"
        >
          {ROLE_OPTIONS.map((opt) => {
            const disabled = Boolean(opt.value) && disabledRoles.has(opt.value);
            const selected = opt.value === value;
            return (
              <li
                key={opt.value || 'random'}
                role="option"
                aria-selected={selected}
                aria-disabled={disabled}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                  disabled
                    ? 'cursor-not-allowed text-white/25'
                    : `cursor-pointer hover:bg-white/10 ${opt.value ? ROLE_COLORS[opt.value] : 'text-white/60'}`
                } ${selected ? 'bg-white/10 font-semibold' : ''}`}
                onClick={() => {
                  if (disabled) return;
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span>
                  {selected && <span aria-hidden>✓ </span>}
                  {opt.label}
                </span>
                {disabled && <InfoHint text={LIMIT_MESSAGES[opt.value]} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function RoleAssignmentPanel({ players, assignments, onChange, limits }) {
  // players = non-master participants
  const playerIds = players.map((p) => p.id);
  const counts = countByRole(assignments, playerIds);

  function setRole(playerId, role) {
    onChange({ ...assignments, [playerId]: role || undefined });
  }

  function clearAll() {
    onChange({});
  }

  const assignedCount = playerIds.filter((id) => assignments[id]).length;

  // Rola jest zablokowana dla gracza, gdy limit jest już wyczerpany przez INNYCH graczy.
  function disabledRolesFor(playerId) {
    const disabled = new Set();
    if (!limits) return disabled;
    for (const role of ['mafia', 'detective', 'doctor']) {
      const othersWithRole = counts[role] - (assignments[playerId] === role ? 1 : 0);
      if (othersWithRole >= limits[role]) disabled.add(role);
    }
    return disabled;
  }

  return (
    <div className="stagger space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-white/45">
          Pozostawione na &quot;Losowo&quot; zostaną przydzielone automatycznie.
        </p>
        {assignedCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-brass-400 hover:text-paper-100 transition-colors shrink-0 animate-fade-in"
          >
            Wyczyść
          </button>
        )}
      </div>

      {/* Role count summary */}
      <div className="flex gap-2 flex-wrap">
        {[['mafia', 'text-role-mafia'], ['detective', 'text-role-detective'], ['doctor', 'text-role-doctor'], ['citizen', 'text-role-citizen']].map(([role, color]) => {
          const limit = limits?.[role];
          const over = limit != null && counts[role] > limit;
          return (
            <span
              key={role}
              className={`text-[13px] font-semibold ${over ? 'text-blood ring-1 ring-blood/50' : color} bg-white/5 rounded-full px-2 py-0.5`}
            >
              {ROLE_LABELS[role]}: {counts[role]}
              {limit != null ? `/${limit}` : ''}
            </span>
          );
        })}
      </div>

      {/* Player list with role selects */}
      <ul className="space-y-2 stagger [--stagger-step:35ms]">
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

              <RoleSelect
                value={selected}
                onChange={(role) => setRole(player.id, role)}
                disabledRoles={disabledRolesFor(player.id)}
              />
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
