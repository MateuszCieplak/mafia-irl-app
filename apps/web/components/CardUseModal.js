'use client';

import { useState } from 'react';
import AnimatedModal from '@/components/AnimatedModal';
import { CARD_INFO } from '@/lib/cards';

const ERRORS = {
  wrong_phase: 'Kartę możesz zgłosić tylko podczas głosowania.',
  eliminated: 'Jesteś wyeliminowany(a).',
  card_used: 'Ta karta została już wykorzystana.',
  already_queued: 'Ta karta jest już zgłoszona na tę noc.',
  no_card: 'Nie masz takiej karty.',
  cards_disabled: 'Tryb kart jest wyłączony.',
  not_connected: 'Brak połączenia z serwerem.',
  timeout: 'Serwer nie odpowiedział — spróbuj ponownie.',
};

function errorText(res) {
  if (res?.error === 'too_early') {
    return `Ta karta będzie dostępna najwcześniej w nocy rundy ${res.availableFromRound}.`;
  }
  return ERRORS[res?.error] || `Nie udało się: ${res?.error || 'nieznany błąd'}`;
}

/**
 * Okno „Użyj karty” (faza głosowania). Wygląda tak samo dla wszystkich graczy —
 * gracz bez karty dostaje po prostu informację, że jej nie ma, więc samo kliknięcie
 * przycisku nikogo nie zdradza.
 */
export default function CardUseModal({ open, onClose, cards, round, onDeclare }) {
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  async function handleUse(card) {
    setBusy(card.type);
    setMessage(null);
    try {
      const res = await onDeclare(card.type);
      if (res?.ok) {
        setMessage({
          ok: true,
          text: res.queued
            ? 'Zgłoszono. W nocy master Cię obudzi — zrób to dyskretnie, bez słowa.'
            : 'Karta użyta. Wynik zobaczycie po zakończeniu głosowania.',
        });
      } else {
        setMessage({ ok: false, text: errorText(res) });
      }
    } finally {
      setBusy(null);
    }
  }

  function handleClose() {
    setMessage(null);
    onClose();
  }

  return (
    <AnimatedModal
      open={open}
      onClose={handleClose}
      cardClassName="card max-w-sm w-full space-y-3 text-left"
    >
      <h3 className="font-display text-lg font-bold">Karty mocy</h3>

      {(!cards || cards.length === 0) && (
        <p className="text-white/50 text-sm">Nie masz karty mocy.</p>
      )}

      {cards?.map((card) => {
        const info = CARD_INFO[card.type];
        if (!info) return null;
        const tooEarly = card.nightCard && round + 1 < card.availableFromRound;
        const disabled = card.used || card.queued || tooEarly || busy !== null;
        let status = null;
        if (card.used) status = 'Wykorzystana';
        else if (card.queued) status = 'Zgłoszona — czeka na noc';
        else if (tooEarly) status = `Dostępna od nocy rundy ${card.availableFromRound}`;

        return (
          <div key={card.type} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xl" aria-hidden>
                {info.icon}
              </span>
              <span className="font-display font-semibold">{info.name}</span>
              <span className="ml-auto text-[12px] uppercase tracking-wide text-white/35">{info.team}</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">{info.how}</p>
            {status ? (
              <p className="text-xs text-amber-300/90">{status}</p>
            ) : (
              <p className="text-xs text-white/40 leading-relaxed">{info.useHint}</p>
            )}
            <button
              type="button"
              className="btn-primary w-full"
              disabled={disabled}
              onClick={() => handleUse(card)}
            >
              {busy === card.type ? 'Zgłaszam…' : 'Użyj karty'}
            </button>
          </div>
        );
      })}

      {message && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            message.ok ? 'bg-emerald-900/30 text-safe' : 'bg-flame-500/30 text-paper-100'
          }`}
        >
          {message.text}
        </p>
      )}

      <button type="button" className="btn-ghost w-full" onClick={handleClose}>
        Zamknij
      </button>
    </AnimatedModal>
  );
}
