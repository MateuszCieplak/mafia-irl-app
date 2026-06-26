'use client';

const KIND_LABELS = {
  roles_assigned: 'Role przydzielone',
  night_detective: 'Detektyw',
  night_doctor: 'Lekarz',
  night_mafia: 'Mafia',
  day_vote: 'Głosowanie',
  night_result: 'Wynik nocy',
  vote_result: 'Wynik głosowania',
};

const KIND_COLORS = {
  roles_assigned: 'text-white/70',
  night_detective: 'text-blue-400',
  night_doctor: 'text-safe',
  night_mafia: 'text-blood',
  day_vote: 'text-yellow-400',
  night_result: 'text-orange-400',
  vote_result: 'text-orange-400',
};

function playerName(id, players) {
  if (!id) return '—';
  const p = players.find((pl) => pl.id === id);
  return p?.username || id;
}

function formatEntry(entry, players) {
  const { kind } = entry;

  if (kind === 'night_result') {
    if (entry.protection_was_effective) {
      const prot = entry.protectedName || playerName(entry.protectedId, players);
      return `Lekarz uratował ${prot} — nikt nie zginął!`;
    }
    if (entry.killedName || entry.eliminatedId) {
      const name = entry.killedName || playerName(entry.eliminatedId, players);
      return `Zginął(a): ${name}`;
    }
    return 'Noc spokojna — nikt nie zginął';
  }

  if (kind === 'vote_result') {
    if (entry.outcome === 'vote_skipped') return 'Głosowanie pominięte';
    if (entry.outcome === 'tie') return 'Remis — nikt nie odpada';
    if (entry.eliminatedName || entry.eliminatedId) {
      const name = entry.eliminatedName || playerName(entry.eliminatedId, players);
      return `Wyrzucony(a): ${name}`;
    }
    return 'Brak rozstrzygnięcia';
  }

  if (kind === 'roles_assigned' && entry.roles) {
    const lines = Object.entries(entry.roles).map(
      ([uid, role]) => `${playerName(uid, players)}: ${role}`,
    );
    return lines.join(', ');
  }

  if (kind === 'night_detective') {
    const target = playerName(entry.targetId, players);
    const result = entry.isMafia ? 'MAFIA' : 'nie mafia';
    return `${playerName(entry.actorId, players)} sprawdził ${target} → ${result}`;
  }

  if (kind === 'night_doctor') {
    const target = playerName(entry.targetId, players);
    return `${playerName(entry.actorId, players)} chroni ${target}`;
  }

  if (kind === 'night_mafia') {
    const votes = Object.entries(entry.votes || {})
      .map(([uid, tid]) => `${playerName(uid, players)}→${playerName(tid, players)}`)
      .join(', ');
    if (entry.consensus) {
      return `Konsensus: zabić ${playerName(entry.finalKillTarget, players)} (${votes})`;
    }
    if (entry.waitingForConsensus) {
      return `Brak zgody (${votes})`;
    }
    return `Głosy: ${votes}`;
  }

  if (kind === 'day_vote') {
    const target = entry.targetId ? playerName(entry.targetId, players) : 'skip';
    return `${playerName(entry.voterId, players)} → ${target}`;
  }

  return JSON.stringify(entry);
}

const RESULT_KINDS = new Set(['night_result', 'vote_result']);

export default function MasterInsightFeed({ entries, players }) {
  if (!entries || entries.length === 0) return null;

  return (
    <div className="card space-y-2">
      <h3 className="font-display font-bold text-sm text-white/50 uppercase tracking-wider">
        Podgląd live
      </h3>
      <div className="max-h-56 overflow-y-auto space-y-1 text-sm">
        {entries.map((entry, i) => {
          const isResult = RESULT_KINDS.has(entry.kind);
          const isElimination =
            isResult && (entry.eliminatedId || entry.killed);

          return (
            <div
              key={i}
              className={`flex gap-2 leading-snug rounded px-2 py-1 ${
                isElimination
                  ? 'bg-blood/15 border border-blood/30'
                  : isResult
                  ? 'bg-white/5 border border-white/10'
                  : ''
              }`}
            >
              <span
                className={`shrink-0 font-semibold ${KIND_COLORS[entry.kind] || 'text-white/50'}`}
              >
                {KIND_LABELS[entry.kind] || entry.kind}
              </span>
              <span
                className={`${isElimination ? 'text-white font-semibold' : 'text-white/70'}`}
              >
                {formatEntry(entry, players)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
