'use client';

import { useEffect, useRef } from 'react';
import { ROLE_LABELS, ROLE_COLORS, ROLE_BG, ROLE_BORDER } from '../lib/roleTheme';

const KIND_LABELS = {
  roles_assigned: 'Role przydzielone',
  night_detective: 'Detektyw',
  night_doctor: 'Lekarz',
  night_mafia: 'Mafia',
  day_vote: 'Głosowanie',
  night_result: 'Wynik nocy',
  vote_result: 'Wynik głosowania',
  cards_assigned: 'Karty mocy',
  card_declared: 'Karta',
  card_check: 'Sprawdzenie',
  card_mafia: 'Karta mafii',
};

const KIND_COLORS = {
  roles_assigned: 'text-white/70',
  night_detective: 'text-blue-400',
  night_doctor: 'text-safe',
  night_mafia: 'text-blood',
  day_vote: 'text-yellow-400',
  night_result: 'text-orange-400',
  vote_result: 'text-orange-400',
  cards_assigned: 'text-fuchsia-300',
  card_declared: 'text-fuchsia-300',
  card_check: 'text-sky-300',
  card_mafia: 'text-blood',
};

const CARD_NAMES = {
  check: 'Sprawdzenie',
  shield: 'Tarcza',
  mafia_shield: 'Tarcza mafii',
  alibi: 'Alibi',
  jam: 'Zakłócenie',
  false_lead: 'Fałszywy trop',
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
    if (entry.outcome === 'shielded') {
      const by = (entry.shieldedBy || []).map((id) => playerName(id, players)).join(', ');
      return `Tarcza zadziałała — ${entry.shieldedName || playerName(entry.shieldedId, players)} zostaje w grze (użył(a): ${by})`;
    }
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

  if (kind === 'cards_assigned') {
    const holders = (entry.overview?.holders || []).map(
      (h) => `${playerName(h.userId, players)}: ${CARD_NAMES[h.type] || h.type}`,
    );
    const mafia = (entry.overview?.mafia || []).map((c) => CARD_NAMES[c.type] || c.type);
    const parts = [...holders];
    if (mafia.length) parts.push(`Mafia: ${mafia.join(', ')}`);
    return parts.join(' · ') || 'Brak kart';
  }

  if (kind === 'card_declared') {
    const name = CARD_NAMES[entry.cardType] || entry.cardType;
    return `${playerName(entry.actorId, players)} zgłasza kartę „${name}”`;
  }

  if (kind === 'card_check') {
    const names = (entry.targetIds || []).map((id) => playerName(id, players)).join(', ');
    const extras = [];
    if (entry.jammed) extras.push('ZAKŁÓCONE');
    if (entry.alibiHits?.length) extras.push(`alibi: ${entry.alibiHits.map((id) => playerName(id, players)).join(', ')}`);
    if (entry.falseLeadHits?.length) {
      extras.push(`fałszywy trop: ${entry.falseLeadHits.map((id) => playerName(id, players)).join(', ')}`);
    }
    return `${playerName(entry.actorId, players)} sprawdził ${names} → pokazano ${entry.shownCount} (prawda: ${entry.trueCount})${
      extras.length ? ` [${extras.join('; ')}]` : ''
    }`;
  }

  if (kind === 'card_mafia') {
    const name = CARD_NAMES[entry.cardType] || entry.cardType;
    const target = entry.targetId ? ` → ${playerName(entry.targetId, players)}` : '';
    return `${playerName(entry.actorId, players)} użył(a) „${name}”${target}`;
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
    if (entry.retracted) return `${playerName(entry.voterId, players)} cofnął(ęła) głos`;
    const target = entry.targetId ? playerName(entry.targetId, players) : 'skip';
    return `${playerName(entry.voterId, players)} → ${target}${entry.changed ? ' (zmiana głosu)' : ''}`;
  }

  return JSON.stringify(entry);
}

const RESULT_KINDS = new Set(['night_result', 'vote_result']);

const ROLE_ORDER = ['mafia', 'detective', 'doctor', 'citizen'];

function RolesTable({ roles, players }) {
  const groups = ROLE_ORDER.map((role) => ({
    role,
    names: Object.entries(roles)
      .filter(([, r]) => r === role)
      .map(([uid]) => playerName(uid, players)),
  }));
  const known = new Set(ROLE_ORDER);
  const others = Object.entries(roles).filter(([, r]) => !known.has(r));
  if (others.length) {
    groups.push({ role: 'other', names: others.map(([uid, r]) => `${playerName(uid, players)} (${r})`) });
  }

  return (
    <div className="flex-1 min-w-0 rounded-lg border border-white/10 overflow-hidden">
      {groups
        .filter((g) => g.names.length > 0)
        .map((g) => (
          <div
            key={g.role}
            className={`flex items-stretch border-b border-white/10 last:border-b-0 ${ROLE_BORDER[g.role] || ''}`}
          >
            <div
              className={`w-28 shrink-0 flex items-center justify-between gap-2 px-2 py-1.5 bg-white/5 font-semibold ${
                ROLE_COLORS[g.role] || 'text-white/60'
              }`}
            >
              <span>{ROLE_LABELS[g.role] || 'Inne'}</span>
              <span className={`text-xs rounded-full px-1.5 py-0.5 text-black/80 ${ROLE_BG[g.role] || 'bg-white/40'}`}>
                {g.names.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 px-2 py-1.5 min-w-0">
              {g.names.map((n, i) => (
                <span
                  key={i}
                  className={`rounded px-2 py-0.5 bg-white/5 border text-white/90 ${
                    ROLE_BORDER[g.role] || 'border-white/10'
                  }`}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

export default function MasterInsightFeed({ entries, players }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const isEmpty = !entries || entries.length === 0;

  return (
    <div className="card flex flex-col min-h-0 h-full">
      <h3 className="font-display font-bold text-sm text-white/50 uppercase tracking-wider shrink-0 mb-2">
        Podgląd live
      </h3>
      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <p className="text-white/30 text-sm text-center px-4 animate-fade-in">
            Tu zobaczysz na żywo ruchy graczy (sprawdzenia detektywa, ochronę lekarza, głosy mafii i głosowanie dzienne).
          </p>
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto space-y-1 text-sm min-h-0">
        {entries.map((entry, i) => {
          const isResult = RESULT_KINDS.has(entry.kind);
          const isElimination = isResult && (entry.eliminatedId || entry.killed);

          return (
            <div
              key={i}
              className={`flex gap-2 leading-snug rounded px-2 py-1.5 animate-slide-in-left ${
                entry.kind === 'roles_assigned' ? 'items-start ' : ''}${
                isElimination
                  ? 'bg-blood/15 border border-blood/30'
                  : isResult
                  ? 'bg-white/5 border border-white/10'
                  : ''
              }`}
            >
              <span className={`shrink-0 font-semibold ${KIND_COLORS[entry.kind] || 'text-white/50'}`}>
                {KIND_LABELS[entry.kind] || entry.kind}
              </span>
              {entry.kind === 'roles_assigned' && entry.roles ? (
                <RolesTable roles={entry.roles} players={players} />
              ) : (
                <span className={`${isElimination ? 'text-white font-semibold' : 'text-white/70'}`}>
                  {formatEntry(entry, players)}
                </span>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      )}
    </div>
  );
}
