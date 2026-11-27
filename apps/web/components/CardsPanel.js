'use client';

import {
  CARD_INFO,
  checkEntrySentence,
  mafiaCardEntrySentence,
  revealEntrySentence,
  shieldEntrySentence,
} from '@/lib/cards';

/**
 * Widok „Karty mocy” w menu gry: moje karty, ich stan i dziennik wyników
 * (Sprawdzenie obywatela / użycia kart mafii).
 */
export default function CardsPanel({ cards = [], cardLog = [], mafiaCard = null, players = [], round = 0 }) {
  const nameOf = (id) => players.find((p) => p.id === id)?.username || '—';
  const log = cardLog.filter((e) => e.kind === 'check');
  const shieldLog = cardLog.filter((e) => e.kind === 'shield');
  const revealLog = cardLog.filter((e) => e.kind === 'reveal');
  const mafiaLog = mafiaCard?.log || [];
  const wards = mafiaCard?.wards;

  if (cards.length === 0) {
    return <p className="text-sm text-white/50">Nie masz karty mocy w tej grze.</p>;
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {cards.map((card) => {
          const info = CARD_INFO[card.type];
          if (!info) return null;
          let status = 'Gotowa do użycia (przycisk „Użyj karty” w głosowaniu)';
          if (card.used) status = 'Wykorzystana';
          else if (card.queued) status = 'Zgłoszona — czeka na noc';
          else if (card.nightCard && round < card.availableFromRound) {
            status = `Dostępna od głosowania w rundzie ${card.availableFromRound}`;
          }
          return (
            <li key={card.id || card.type} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xl" aria-hidden>
                  {info.icon}
                </span>
                <span className="font-display font-semibold">{info.name}</span>
                <span className="ml-auto text-[12px] uppercase tracking-wide text-white/35">{info.team}</span>
              </div>
              <p className="text-xs text-white/55 leading-relaxed">{info.how}</p>
              <p className={`text-xs ${card.used ? 'text-white/40' : 'text-amber-300/90'}`}>{status}</p>
            </li>
          );
        })}
      </ul>

      {log.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-[12px] uppercase tracking-wider text-white/40">Wyniki Sprawdzenia</h4>
          <ul className="space-y-1.5">
            {log.map((entry, i) => (
              <li key={i} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm">
                {checkEntrySentence(entry, nameOf)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {revealLog.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-[12px] uppercase tracking-wider text-white/40">Wyniki Odkrycia</h4>
          <ul className="space-y-1.5">
            {revealLog.map((entry, i) => (
              <li key={i} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm">
                {revealEntrySentence(entry, nameOf)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {shieldLog.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-[12px] uppercase tracking-wider text-white/40">Wyniki Tarczy</h4>
          <ul className="space-y-1.5">
            {shieldLog.map((entry, i) => (
              <li key={i} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm">
                {shieldEntrySentence(entry, nameOf)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mafiaCard && (
        <section className="space-y-1.5">
          <h4 className="text-[12px] uppercase tracking-wider text-white/40">Dziennik kart mafii</h4>
          {mafiaLog.length === 0 ? (
            <p className="text-xs text-white/40">Jeszcze nie użyto żadnej karty specjalnej.</p>
          ) : (
            <ul className="space-y-1.5">
              {mafiaLog.map((entry, i) => (
                <li key={i} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm">
                  {mafiaCardEntrySentence(entry, nameOf)}
                </li>
              ))}
            </ul>
          )}
          {wards && (wards.alibi.length > 0 || wards.falseLead.length > 0 || wards.jam > 0) && (
            <div className="rounded-lg bg-amber-900/20 border border-amber-500/20 px-3 py-2 text-xs text-amber-200/90 space-y-0.5">
              <p className="font-semibold">Aktywne efekty (czekają na Sprawdzenie):</p>
              {wards.alibi.length > 0 && <p>Alibi: {wards.alibi.map(nameOf).join(', ')}</p>}
              {wards.falseLead.length > 0 && <p>Fałszywy trop: {wards.falseLead.map(nameOf).join(', ')}</p>}
              {wards.jam > 0 && <p>Zakłócenie: następne Sprawdzenie pokaże błędny wynik</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
