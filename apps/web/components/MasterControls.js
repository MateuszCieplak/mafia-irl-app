'use client';

import { useState } from 'react';
import PhaseBadge from '@/components/PhaseBadge';
import TurnTimer from '@/components/TurnTimer';
import { CARD_PHASES, CARD_INFO, mafiaCountLabel } from '@/lib/cards';

const PHASE_ACTIONS = {
  null: 'Rozpocznij noc',
  role_reveal: 'Rozpocznij fazę detektywa',
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
  role_reveal: { icon: '🎭', text: 'Gracze poznają swoje role' },
  night_mafia_card: { icon: '🃏', text: 'Budzi się Mafia i wykorzystuje swoją kartę' },
  night_citizen_card: { icon: '🃏', text: 'Budzi się obywatel i wykorzystuje swoją kartę mocy' },
  night_detective: { icon: '🔍', text: 'Budzi się Detektyw' },
  night_doctor: { icon: '💊', text: 'Budzi się Lekarz' },
  night_mafia: { icon: '🔫', text: 'Budzi się Mafia' },
  night_resolve: { icon: '🌅', text: 'Rozstrzygnięcie nocy' },
  day_deliberation: { icon: '🗣️', text: 'Czas na dyskusję' },
  day_vote: { icon: '🗳️', text: 'Głosowanie' },
  day_resolve: { icon: '⚖️', text: 'Rozstrzygnięcie głosowania' },
};

// Fazy, w których kliknięcie przycisku jest zamierzonym krokiem gry, a nie
// pominięciem trwającej akcji — nie dodajemy do nich prefiksu „Pomiń”.
const DELIBERATE_ADVANCE_PHASES = new Set(['role_reveal', 'night_resolve', 'day_resolve']);

const ROLE_LABELS_PL = {
  detective: 'Detektyw',
  doctor: 'Lekarz',
  mafia: 'Mafia',
  citizen_card: 'Karta obywatela',
  mafia_card: 'Karta mafii',
};

// Skróty nazw faz do etykiety przycisku, gdy w grze są tury kart (kolejność zależy od ustawień).
const PHASE_SHORT = {
  night_mafia_card: 'Karta mafii',
  night_citizen_card: 'Karta obywatela',
  night_detective: 'Detektyw',
  night_doctor: 'Lekarz',
  night_mafia: 'Mafia',
  night_resolve: 'Rozstrzygnięcie nocy',
};

function advanceLabelFor(phase, nextPhase) {
  const touchesCards = CARD_PHASES.includes(phase) || CARD_PHASES.includes(nextPhase);
  if (!touchesCards) return PHASE_ACTIONS[phase] ?? PHASE_ACTIONS[null];
  if (!phase || phase === 'role_reveal') return `Rozpocznij: ${PHASE_SHORT[nextPhase] ?? 'noc'}`;
  return `${PHASE_SHORT[phase] ?? phase} → ${PHASE_SHORT[nextPhase] ?? 'dalej'}`;
}

function playerName(id, players) {
  if (!id) return '—';
  const p = players?.find((pl) => pl.id === id);
  return p?.username || id;
}

function submissionDetail(role, data, players) {
  if (!data || !data.submitted) return null; // submitted:false (cofnięty głos mafii) → „Oczekuje…”
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
  if (role === 'citizen_card' && data.cardType === 'reveal') {
    return `${playerName(data.actorId, players)} odkrył(a) ${playerName(data.targetId, players)} → ${data.role}`;
  }
  if (role === 'citizen_card') {
    const names = (data.targetIds || []).map((id) => playerName(id, players)).join(', ');
    return `${playerName(data.actorId, players)} sprawdził(a) ${names} → pokazano ${mafiaCountLabel(data.count)}${
      data.jammed ? ' (zakłócone)' : ''
    }`;
  }
  if (role === 'mafia_card') {
    const info = CARD_INFO[data.cardType];
    return `${info?.name || data.cardType}${data.targetId ? ` → ${playerName(data.targetId, players)}` : ''}`;
  }
  return null;
}

export default function MasterControls({
  phase,
  round,
  turn = 0,
  turnCount = 1,
  phaseDeadline,
  submissions,
  voteStatus,
  players,
  nextPhase = null,
  cardQueue = null,
  cardsOverview = null,
  onAdvance,
  onEndGame,
}) {
  const [advancing, setAdvancing] = useState(false);
  const [ending, setEnding] = useState(false);
  const quote = PHASE_QUOTES[phase] ?? PHASE_QUOTES[null];

  // Wielu lekarzy/detektywów: „Detektyw 1/2” i przycisk prowadzący do następnej tury.
  const turnRole = {
    night_detective: 'Detektyw',
    night_doctor: 'Lekarz',
    night_citizen_card: 'Karta obywatela',
  }[phase];
  const multiTurn = Boolean(turnRole) && turnCount > 1;
  const hasNextTurn = multiTurn && turn + 1 < turnCount;
  const label = hasNextTurn
    ? `${turnRole} ${turn + 1} → ${turnRole} ${turn + 2}`
    : advanceLabelFor(phase, nextPhase);
  const quoteText = multiTurn ? `${quote.text} (${turn + 1}/${turnCount})` : quote.text;

  // Głosowanie dzienne: przycisk zablokowany, dopóki nie zagłosują wszyscy żywi gracze.
  const votersAlive = (players || []).filter((p) => !p.isMaster && !p.eliminated);
  const missingVoters = votersAlive.filter((p) => !voteStatus?.[p.id]);
  const votesComplete = missingVoters.length === 0;
  const votesBlock = phase === 'day_vote' && !votesComplete;

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

      {/* Runda / faza / timer — dawniej dolny pasek ekranu */}
      <div className="flex items-center justify-between gap-3">
        <PhaseBadge phase={phase} round={round} compact animate={false} />
        <TurnTimer phaseDeadline={phaseDeadline} phase={phase} />
      </div>

      {/* Cytat fazowy */}
      <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
        <span className="text-lg">{quote.icon}</span>
        <span className="font-display font-semibold text-white/90 text-sm">{quoteText}</span>
      </div>

      {/* Tury kart: master wie, czy ktoś zgłosił użycie, czy to blef dla reszty grupy */}
      {phase === 'night_citizen_card' && (
        <CardAnnounce text="Powiedz na głos: „Budzi się obywatel i używa karty mocy”. Nie mów, jakiej karty." />
      )}
      {phase === 'night_mafia_card' && (
        <CardAnnounce text="Powiedz na głos: „Budzi się mafia i używa karty mocy”. Nie mów, jakiej karty." />
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

      {phase === 'day_vote' && (
        <div
          className={`rounded-lg px-3 py-2 text-sm border ${
            votesComplete
              ? 'bg-safe/10 border-safe/30 text-safe'
              : 'bg-yellow-400/10 border-yellow-400/30 text-yellow-200'
          }`}
        >
          {votesComplete ? (
            <span className="font-semibold">✓ Wszyscy gracze zagłosowali</span>
          ) : (
            <>
              <span className="font-semibold">
                Zagłosowało {votersAlive.length - missingVoters.length}/{votersAlive.length}
              </span>
              <span className="block text-xs opacity-80">
                Czekamy na: {missingVoters.map((p) => p.username).join(', ')}
              </span>
            </>
          )}
        </div>
      )}

      <CardsOverview overview={cardsOverview} players={players} />

      <button
        onClick={handleAdvance}
        disabled={advancing || votesBlock}
        className="btn-primary w-full"
      >
        {advancing
          ? 'Przechodzenie…'
          : votesBlock
          ? 'Czekaj na wszystkie głosy'
          : DELIBERATE_ADVANCE_PHASES.has(phase)
          ? label
          : `Pomiń: ${label}`}
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

function CardAnnounce({ text }) {
  return (
    <div className="rounded-lg px-3 py-2 text-xs leading-relaxed bg-fuchsia-500/10 border border-fuchsia-400/30 text-fuchsia-100">
      <p>
        <span className="font-semibold">🃏 Użyto karty mocy.</span> {text}
      </p>
    </div>
  );
}

const CARD_NAMES_PL = {
  check: 'Sprawdzenie',
  reveal: 'Odkrycie',
  shield: 'Tarcza',
  mafia_shield: 'Tarcza mafii',
  alibi: 'Alibi',
  jam: 'Zakłócenie',
  false_lead: 'Fałszywy trop',
};

function CardsOverview({ overview, players }) {
  const team = overview?.team || [];
  if (!overview || (!overview.holders?.length && !team.length)) return null;
  return (
    <details className="rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
      <summary className="cursor-pointer font-semibold text-white/60">Karty w grze</summary>
      <ul className="mt-1.5 space-y-0.5">
        {(overview.holders || []).map((h, i) => (
          <li key={`${h.userId}-${h.type}-${i}`} className={h.used ? 'opacity-50 line-through' : ''}>
            {playerName(h.userId, players)}: {CARD_NAMES_PL[h.type] || h.type}
          </li>
        ))}
        {team.map((c) => (
          <li key={`${c.team}-${c.type}`} className={c.used ? 'opacity-50 line-through' : ''}>
            {c.team === 'mafia' ? 'Mafia (wspólna)' : 'Obywatele (wspólna)'}: {CARD_NAMES_PL[c.type] || c.type}
          </li>
        ))}
      </ul>
    </details>
  );
}
