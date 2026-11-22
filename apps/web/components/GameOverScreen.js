'use client';

import { useMemo, useState } from 'react';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/roleTheme';
import { CARD_INFO, mafiaCountLabel } from '@/lib/cards';

// Kolory stron — te same co banery wygranej (mafia: role-mafia, miasto: role-detective).
const MAFIA_HEX = '#d9453a';
const TOWN_HEX = '#6fbf8a';

function nameFrom(map, id) {
  if (!id) return '—';
  const raw = (map.get(id)?.username || '').trim();
  if (!raw) return id.slice(0, 8);
  return raw.includes('@') ? raw.split('@')[0] : raw;
}

function RoleTag({ role }) {
  if (!role) return null;
  return <span className={`font-semibold ${ROLE_COLORS[role] || 'text-white/70'}`}>{ROLE_LABELS[role] || role}</span>;
}

/* ── Szanse: linia „szansa miasta” po każdym etapie gry ─────────────────── */
function OddsChart({ odds }) {
  const [hover, setHover] = useState(null);
  if (!odds || odds.length < 2) return null;

  // Szeroki, niski wykres — nie zabiera miejsca przebiegowi gry pod spodem.
  const W = 520;
  const H = 120;
  const padL = 44;
  const padR = 10;
  const padT = 10;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const x = (i) => padL + (odds.length === 1 ? innerW / 2 : (i / (odds.length - 1)) * innerW);
  const y = (pct) => padT + (1 - pct / 100) * innerH;
  const path = odds.map((o, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(o.townPct).toFixed(1)}`).join(' ');
  const area = `${path} L${x(odds.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const h = hover != null ? odds[hover] : null;
  // Etykiety osi X tylko co któryś punkt, żeby się nie nachodziły.
  const step = Math.max(1, Math.ceil(odds.length / 6));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-h-36 block" role="img" aria-label="Szansa wygranej miasta po każdym etapie gry">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              className="text-white/10"
              strokeDasharray={v === 50 ? '3 3' : undefined}
            />
            <text x={padL - 8} y={y(v) + 5} textAnchor="end" className="fill-white/40" fontSize="15">
              {v}%
            </text>
          </g>
        ))}
        <path d={area} fill={TOWN_HEX} opacity="0.10" />
        <path d={path} fill="none" stroke={TOWN_HEX} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {h && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} stroke="currentColor" className="text-white/25" />}
        {odds.map((o, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(o.townPct)} r={hover === i ? 5 : 4} fill={TOWN_HEX} stroke="#15110e" strokeWidth="2" />
            {i % step === 0 || i === odds.length - 1 ? (
              <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-white/40" fontSize="15">
                {o.stage === 'start' ? 'Start' : `${o.stage === 'night' ? 'N' : 'D'}${o.round}`}
              </text>
            ) : null}
            {/* Duży obszar trafienia — łatwy hover/tap także na telefonie */}
            <rect
              x={x(i) - innerW / Math.max(1, odds.length - 1) / 2}
              y={padT}
              width={innerW / Math.max(1, odds.length - 1)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover((cur) => (cur === i ? null : i))}
            />
          </g>
        ))}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-brass-500/30 bg-ink-900/95 px-2.5 py-1.5 text-[11px] shadow-xl"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover > odds.length / 2 ? '-105%' : '5%'})`,
          }}
        >
          <p className="font-semibold text-paper-100">{h.label}</p>
          <p className="text-white/70">
            Miasto {h.townPct}% · Mafia {h.mafiaPct}%
          </p>
          <p className="text-white/40">
            Żywi: {h.townAlive} miasto / {h.mafiaAlive} mafia
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Pasek szans pod etapem w przebiegu gry ─────────────────────────────── */
function OddsBar({ point }) {
  if (!point) return null;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {point.townPct > 0 && <div className="rounded-full" style={{ width: `${point.townPct}%`, background: TOWN_HEX }} />}
        {point.mafiaPct > 0 && <div className="rounded-full" style={{ width: `${point.mafiaPct}%`, background: MAFIA_HEX }} />}
      </div>
      <p className="flex justify-between text-[10px] text-white/45">
        <span>Miasto {point.townPct}%</span>
        <span>
          {point.townAlive} vs {point.mafiaAlive}
        </span>
        <span>Mafia {point.mafiaPct}%</span>
      </p>
    </div>
  );
}

function Line({ icon, children, strong = false }) {
  return (
    <li className={`flex gap-2 ${strong ? 'text-paper-100 font-semibold' : 'text-white/65'}`}>
      <span className="w-4 shrink-0 text-center" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function NightBlock({ night, names, roles, point }) {
  const n = (id) => nameFrom(names, id);
  const r = night.result;
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
      <p className="section-eyebrow !text-[10px] mb-1">🌙 Noc</p>
      <ul className="space-y-0.5 text-xs">
        {night.detective.map((d, i) => (
          <Line key={`d${i}`} icon="🔍">
            {n(d.actorId)} sprawdził(a) {n(d.targetId)} →{' '}
            <span className={d.isMafia ? 'text-role-mafia font-semibold' : 'text-white/80'}>
              {d.isMafia ? 'mafia' : 'nie mafia'}
            </span>
          </Line>
        ))}
        {night.doctor.map((d, i) => (
          <Line key={`l${i}`} icon="💊">
            {n(d.actorId)} chronił(a) {n(d.targetId)}
          </Line>
        ))}
        {night.mafiaTarget ? (
          <Line icon="🔫">Mafia wybrała: {n(night.mafiaTarget)}</Line>
        ) : (
          <Line icon="🔫">Mafia nie wybrała wspólnego celu</Line>
        )}
        {night.cards.map((c, i) =>
          c.kind === 'check' ? (
            <Line key={`c${i}`} icon="🃏">
              {n(c.actorId)} użył(a) Sprawdzenia ({c.targetIds.map(n).join(', ')}) → {mafiaCountLabel(c.shownCount)}
              {c.jammed ? ' (zakłócone)' : ''}
            </Line>
          ) : (
            <Line key={`c${i}`} icon="🃏">
              Mafia: „{CARD_INFO[c.cardType]?.name || c.cardType}”{c.targetId ? ` → ${n(c.targetId)}` : ''}
            </Line>
          ),
        )}
        {r && (
          <Line icon={r.eliminatedId ? '☠' : r.saved ? '🛡' : '🌅'} strong>
            {r.eliminatedId ? (
              <>
                Zginął(a) {n(r.eliminatedId)} (<RoleTag role={r.eliminatedRole || roles[r.eliminatedId]} />)
              </>
            ) : r.saved ? (
              'Lekarz uratował cel mafii'
            ) : r.immunity ? (
              'Detektyw przeżył dzięki immunitetowi 1. nocy'
            ) : (
              'Spokojna noc — nikt nie zginął'
            )}
          </Line>
        )}
      </ul>
      <OddsBar point={point} />
    </div>
  );
}

const VOTE_OUTCOME = {
  vote_skipped: 'Większość pominęła głosowanie',
  tie: 'Remis — nikt nie odpadł',
  no_elimination: 'Nikt nie odpadł',
};

function DayBlock({ day, names, roles, point }) {
  const n = (id) => nameFrom(names, id);
  const tally = new Map();
  for (const [voter, target] of Object.entries(day.votes || {})) {
    const key = target || '__skip';
    if (!tally.has(key)) tally.set(key, []);
    tally.get(key).push(voter);
  }
  const rows = [...tally.entries()].sort((a, b) => b[1].length - a[1].length);
  const r = day.result;
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
      <p className="section-eyebrow !text-[10px] mb-1">☀ Dzień — głosowanie</p>
      <ul className="space-y-0.5 text-xs">
        {rows.map(([target, voters]) => (
          <Line key={target} icon="🗳">
            <span className="text-white/85">{target === '__skip' ? 'Pominięcie' : n(target)}</span>
            <span className="text-white/45">
              {' '}
              — {voters.length} {voters.length === 1 ? 'głos' : voters.length < 5 ? 'głosy' : 'głosów'} ({voters.map(n).join(', ')})
            </span>
          </Line>
        ))}
        {day.cards.map((c, i) => (
          <Line key={`c${i}`} icon="🃏">
            {n(c.actorId)} zgłosił(a) kartę „{CARD_INFO[c.cardType]?.name || c.cardType}”
          </Line>
        ))}
        {r && (
          <Line icon={r.eliminatedId ? '⚖' : r.outcome === 'shielded' ? '🛡' : '🤝'} strong>
            {r.eliminatedId ? (
              <>
                Wyrzucony(a) {n(r.eliminatedId)} (<RoleTag role={r.eliminatedRole || roles[r.eliminatedId]} />)
              </>
            ) : r.outcome === 'shielded' ? (
              `Tarcza ocaliła ${n(r.shieldedId)}`
            ) : (
              VOTE_OUTCOME[r.outcome] || 'Nikt nie odpadł'
            )}
          </Line>
        )}
      </ul>
      <OddsBar point={point} />
    </div>
  );
}

function Timeline({ summary, names, roles }) {
  const pointFor = (round, stage) => summary.odds?.find((o) => o.round === round && o.stage === stage) || null;
  if (!summary.rounds?.length) {
    return <p className="text-sm text-white/40">Gra zakończyła się przed pierwszym rozstrzygnięciem — brak ruchów do pokazania.</p>;
  }
  return (
    <ol className="space-y-3">
      {summary.rounds.map((r) => (
        <li key={r.round} className="space-y-1.5">
          <p className="font-display text-sm font-bold text-paper-100">Runda {r.round}</p>
          {r.night && <NightBlock night={r.night} names={names} roles={roles} point={pointFor(r.round, 'night')} />}
          {r.day && <DayBlock day={r.day} names={names} roles={roles} point={pointFor(r.round, 'day')} />}
        </li>
      ))}
    </ol>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-lg border border-brass-500/20 bg-ink-800/80 px-2 py-1.5 sm:px-3 sm:py-2 min-w-0 text-center sm:text-left">
      <p className="font-display text-base sm:text-lg font-bold text-paper-100 leading-tight">{value}</p>
      <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.1em] sm:tracking-[0.15em] text-white/40 leading-tight">{label}</p>
    </div>
  );
}

function PlayersPanel({ list }) {
  return (
    <ul className="space-y-1.5">
      {list.map((p) => (
        <li
          key={p.id}
          className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 ${
            p.fate ? 'border-white/5 bg-white/[0.02] opacity-70' : 'border-brass-500/20 bg-ink-800/70'
          }`}
        >
          {p.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover ring-1 ring-white/20 shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0">
              {(p.username || '?')[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm text-paper-100 truncate">
              {p.username}
              {p.isBot && <span className="text-white/35 text-xs"> (bot)</span>}
            </p>
            <p className="text-xs">
              <RoleTag role={p.role} />
            </p>
          </div>
          <span className="text-[11px] text-white/50 shrink-0 text-right">
            {!p.fate
              ? '✓ przeżył(a)'
              : p.fate.type === 'night'
              ? `☠ noc ${p.fate.round}`
              : p.fate.type === 'vote'
              ? `⚖ dzień ${p.fate.round}`
              : '☠ odpadł(a)'}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Ekran końca gry: werdykt, statystyki, wykres szans, przebieg rund i role graczy.
 * Bez przewijania całej strony — przewijają się tylko kolumny, a przyciski są
 * zawsze widoczne w dolnym pasku.
 */
export default function GameOverScreen({
  gameOver,
  players,
  round,
  isMaster,
  masterInLobby = false,
  onReturnToRoom,
  onHome,
}) {
  const [tab, setTab] = useState('summary');
  const summary = gameOver?.summary || null;
  const mafiaWon = gameOver?.winner === 'mafia';
  const townWon = gameOver?.winner === 'town';

  const roles = useMemo(() => {
    const out = { ...(gameOver?.roles || {}) };
    for (const p of players || []) if (p.role && !out[p.id]) out[p.id] = p.role;
    return out;
  }, [gameOver?.roles, players]);

  const names = useMemo(() => {
    const m = new Map();
    for (const p of summary?.players || []) m.set(p.id, p);
    for (const p of players || []) m.set(p.id, { ...m.get(p.id), ...p });
    return m;
  }, [summary?.players, players]);

  const playerList = useMemo(() => {
    const avatars = new Map((players || []).map((p) => [p.id, p.avatarUrl]));
    const base = summary?.players?.length
      ? summary.players
      : (players || [])
          .filter((p) => !p.isMaster)
          .map((p) => ({ id: p.id, username: p.username, role: roles[p.id], isBot: p.isBot, fate: p.eliminated ? { type: 'out' } : null }));
    return base
      .map((p) => ({ ...p, username: nameFrom(names, p.id), avatarUrl: avatars.get(p.id) ?? null }))
      .sort((a, b) => Number(Boolean(a.fate)) - Number(Boolean(b.fate)) || (a.role === 'mafia' ? -1 : 0) - (b.role === 'mafia' ? -1 : 0));
  }, [summary?.players, players, roles, names]);

  const titleText = mafiaWon ? 'Mafia wygrywa!' : townWon ? 'Miasto wygrywa!' : 'Gra zakończona';
  const titleClass = mafiaWon ? 'text-role-mafia' : townWon ? 'text-role-detective' : 'text-paper-100';
  const bgClass = isMaster ? 'bg-role-master' : mafiaWon ? 'bg-role-mafia' : townWon ? 'bg-role-detective' : 'bg-night';
  const rounds = summary?.totalRounds ?? round;
  const stats = summary?.stats;
  const survivors = playerList.filter((p) => !p.fate).length;

  const twoCol = isMaster ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2';
  const showTabs = !isMaster;

  const summaryColumn = (
    <section className={`min-h-0 flex flex-col gap-3 ${showTabs && tab !== 'summary' ? 'hidden md:flex' : ''}`}>
      {summary?.odds?.length > 1 && (
        <div className="card !p-3 shrink-0">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="section-eyebrow">Szansa wygranej miasta</p>
            <p
              className="text-[10px] text-white/35"
              title="Szacunek z liczby żywych graczy (model losowy: w nocy mafia zabija obywatela, w dzień miasto wyrzuca losowego gracza). Nie uwzględnia wiedzy detektywa ani lekarza."
            >
              model losowy ⓘ
            </p>
          </div>
          <OddsChart odds={summary.odds} />
        </div>
      )}
      <div className="card !p-3 flex-1 min-h-0 flex flex-col">
        <p className="section-eyebrow mb-2 shrink-0">Przebieg gry</p>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1">
          {summary ? (
            <Timeline summary={summary} names={names} roles={roles} />
          ) : (
            <p className="text-sm text-white/40">Przebieg gry jest niedostępny (np. po restarcie serwera).</p>
          )}
        </div>
      </div>
    </section>
  );

  const playersColumn = (
    <section className={`min-h-0 flex flex-col card !p-3 ${showTabs && tab !== 'players' ? 'hidden md:flex' : ''}`}>
      <div className="flex items-baseline justify-between mb-2 shrink-0">
        <p className="section-eyebrow">Gracze i role</p>
        <span className="text-[11px] text-white/35">
          {survivors} przeżyło / {playerList.length}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1">
        <PlayersPanel list={playerList} />
      </div>
    </section>
  );

  return (
    <div className={`h-dvh overflow-hidden flex flex-col ${bgClass}`}>
      <header className="shrink-0 border-b border-brass-500/15 px-4 pt-4 pb-3 text-center animate-reveal-in">
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/40">
          Koniec gry{isMaster ? ' · panel mastera' : ''}
        </p>
        <h1 className={`font-display text-3xl sm:text-4xl font-bold leading-tight ${titleClass}`}>{titleText}</h1>
        <p className="text-white/40 text-xs mt-1">
          {!mafiaWon && !townWon ? 'Master zakończył rozgrywkę · ' : ''}
          {rounds} {rounds === 1 ? 'runda' : 'rundy'} · wszystkie role ujawnione
        </p>
      </header>

      {stats && (
        <div className="shrink-0 grid grid-cols-4 gap-2 px-3 pt-3">
          <StatTile label="Ofiary nocy" value={stats.mafiaKills} />
          <StatTile label="Uratowani" value={stats.doctorSaves} />
          <StatTile label="Detektyw trafił" value={`${stats.detectiveHits}/${stats.detectiveChecks}`} />
          <StatTile label="Mafia wyrzucona" value={`${stats.mafiaLynched}/${stats.lynches}`} />
        </div>
      )}

      {showTabs && (
        <div className="shrink-0 flex gap-1 px-3 pt-3 md:hidden" role="tablist">
          {[
            ['summary', 'Przebieg'],
            ['players', 'Gracze'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                tab === id ? 'bg-brass-500/15 text-brass-400 ring-1 ring-brass-500/40' : 'text-white/45 hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <main className={`flex-1 min-h-0 grid ${twoCol} gap-3 p-3 overflow-hidden`}>
        {summaryColumn}
        {playersColumn}
      </main>

      <footer className="shrink-0 border-t border-brass-500/25 bg-ink-900/85 backdrop-blur-md px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {masterInLobby && !isMaster && (
          <p className="text-center text-xs text-safe mb-2 animate-fade-in">Master wrócił do pokoju — dołącz do kolejnej gry.</p>
        )}
        <div className="flex gap-3 max-w-xl mx-auto">
          <button
            type="button"
            onClick={onReturnToRoom}
            className={`btn-primary flex-[2] ${masterInLobby && !isMaster ? 'animate-pulse-soft' : ''}`}
          >
            {isMaster ? 'Wróć do pokoju (nowa gra)' : 'Wróć do pokoju'}
          </button>
          <button type="button" onClick={onHome} className="btn-ghost flex-1 whitespace-nowrap">
            Strona główna
          </button>
        </div>
      </footer>
    </div>
  );
}
