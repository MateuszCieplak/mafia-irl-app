'use client';

import { useEffect, useState } from 'react';

export default function VerdictReveal({ verdict, onDismiss, autoShow = false }) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (verdict && autoShow) {
      setVisible(true);
      setClosing(false);
    }
  }, [verdict, autoShow]);

  if (!verdict) return null;

  function show() {
    setVisible(true);
    setClosing(false);
  }

  function dismiss() {
    setClosing(true);
    setTimeout(() => {
      setVisible(false);
      setClosing(false);
      onDismiss?.();
    }, 400);
  }

  if (!visible && !autoShow) {
    return (
      <div className="fixed bottom-24 left-0 right-0 flex justify-center z-40 px-4 pointer-events-none">
        <button type="button" onClick={show} className="btn-primary shadow-lg animate-phase-fade pointer-events-auto">
          Zobacz werdykt
        </button>
      </div>
    );
  }

  if (!visible) return null;

  const isElimination = verdict.type === 'elimination';
  const title =
    verdict.source === 'night'
      ? isElimination
        ? 'Tej nocy zginął(a)'
        : 'Spokojna noc'
      : isElimination
      ? 'Wioska wyrzuciła'
      : verdict.outcome === 'tie'
      ? 'Remis'
      : 'Głosowanie';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        aria-label="Zamknij"
        onClick={dismiss}
      />
      <div
        className={`relative text-center max-w-sm w-full rounded-2xl border p-8 ${
          closing ? 'animate-popup-out' : 'animate-reveal-in'
        } ${
          isElimination
            ? 'bg-blood/20 border-blood/50'
            : 'bg-white/5 border-white/20'
        }`}
      >
        <p className="text-white/50 text-xs uppercase tracking-[0.2em] mb-3">{title}</p>
        {isElimination ? (
          <>
            <p className="font-display text-3xl font-bold text-white mb-2">{verdict.playerName}</p>
            <p className="text-blood text-sm">padł(a) ofiarą…</p>
          </>
        ) : (
          <p className="font-display text-xl text-white/80">{verdict.message}</p>
        )}
        <button type="button" onClick={dismiss} className="btn-secondary mt-6 w-full">
          Zamknij
        </button>
      </div>
    </div>
  );
}
