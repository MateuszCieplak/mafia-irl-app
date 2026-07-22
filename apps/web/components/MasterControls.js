'use client';

import { useState } from 'react';

const PHASE_ACTIONS = {
  null: 'Rozpocznij noc',
  night_detective: 'Detektyw → Lekarz',
  night_doctor: 'Lekarz → Mafia',
  night_mafia: 'Mafia → Rozstrzygnięcie nocy',
  night_resolve: 'Noc → Dzień (dyskusja)',
  day_deliberation: 'Dyskusja → Głosowanie',
  day_vote: 'Głosowanie → Rozstrzygnięcie',
  day_resolve: 'Następna runda',
};

const PHASE_QUOTES = {
  null: { icon: '🌙', text: 'Zapada noc…' },
  night_detective: { icon: '🔍', text: 'Budzi się Detektyw' },
  night_doctor: { icon: '💊', text: 'Budzi się Lekarz' },
  night_mafia: { icon: '🔫', text: 'Budzi się Mafia' },
  night_resolve: { icon: '🌅', text: 'Rozstrzygnięcie nocy' },
  day_deliberation: { icon: '🗣️', text: 'Czas na dyskusję' },
  day_vote: { icon: '🗳️', text: 'Głosowanie' },
  day_resolve: { icon: '⚖️', text: 'Rozstrzygnięcie głosowania' },
};

const ROLE_LABELS_PL = { detective: 'Detektyw', doctor: 'Lekarz', mafia: 'Mafia' };

function playerName(id, players) {
  if (!id) return '—';
  const p = players?.find((pl) => pl.id === id);
  return p?.username || id;
}

function submissionDetail(role, data, players) {
  if (!data || !data.submitted) return null;
  if (role === 'detective') {
    const target = playerName(data.targetId, players);
    const result = data.isMafia ? 'MAFIA' : 'nie mafia';
    return `sprawdził(a) ${target} → ${result}`;
  }
  if (role === 'doctor') {
    return `chroni ${playerName(data.targetId, players)}`;
  }
  if (role === 'mafia') {
    return `cel: ${playerName(data.targetId, players)}`;
  }
  return null;
}

function formatTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function MasterControls({
  phase,
  submissions,
  voteStatus,
  players,
  onAdvance,
  onEndGame,
}) {
  const [advancing, setAdvancing] = useState(false);
  const [ending, setEnding] = useState(false);
  const label = PHASE_ACTIONS[phase] ?? PHASE_ACTIONS[null];
  const quote = PHASE_QUOTES[phase] ?? PHASE_QUOTES[null];

  const voters = phase === 'day_vote'
    ? (players || []).filter((p) => !p.isMaster && !p.eliminated)
    : [];

  async function handleAdvance() {
    setAdvancing(true);
    await onAdvance();
    setAdvancing(false);
  }

  async function handleEnd() {
    if (!confirm('Na pewno zakończyć rozgrywkę? Wszyscy gracze zobaczą ekran końca gry.')) return;
    setEnding(true);
    await onEndGame?.();
    setEnding(false);
  }

  return (
    <div className="card space-y-3">
      <h3 className="font-display font-bold text-sm text-white/50 uppercase tracking-wider">
        Panel Mastera
      </h3>

      {/* Cytat fazowy */}
      <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
        <span className="text-lg">{quote.icon}</span>
        <span className="font-display font-semibold text-white/90 text-sm">{quote.text}</span>
      </div>

      {voters.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[12px] text-white/40 uppercase tracking-wider">
            <span>Status głosowania</span>
            <span>
              {voters.filter((p) => voteStatus?.[p.id]).length}/{voters.length}
            </span>
          </div>
          {voters.map((p) => {
            const votedAt = voteStatus?.[p.id];
            return (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-white/70 shrink-0 truncate">{p.username || p.id}</span>
                <span
                  className={`text-right truncate ${
                    votedAt ? 'text-safe font-semibold' : 'text-white/30'
                  }`}
                >
                  {votedAt ? `✓ zagłosował(a) o ${formatTime(votedAt)}` : 'Oczekuje…'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {submissions && Object.keys(submissions).length > 0 && (
        <div className="space-y-1.5">
          {Object.entries(submissions).map(([role, data]) => {
            const submitted = data === true || data?.submitted;
            const detail = submissionDetail(role, typeof data === 'object' ? data : null, players);
            return (
              <div key={role} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-white/70 shrink-0">{ROLE_LABELS_PL[role] || role}</span>
                <span
                  className={`text-right truncate ${
                    submitted ? 'text-safe font-semibold' : 'text-white/30'
                  }`}
                >
                  {submitted ? `✓ ${detail || 'Gotowe'}` : 'Oczekuje…'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={handleAdvance}
        disabled={advancing}
        className="btn-primary w-full"
      >
        {advancing ? 'Przechodzenie…' : `Pomiń: ${label}`}
      </button>

      {onEndGame && (
        <button
          onClick={handleEnd}
          disabled={ending}
          className="w-full text-xs text-blood/80 hover:text-blood underline-offset-2 hover:underline py-1"
        >
          {ending ? 'Kończenie…' : 'Zakończ rozgrywkę'}
        </button>
      )}
    </div>
  );
}
