'use client';

import { useEffect, useState } from 'react';

const EXIT_MS = 220;

/**
 * Modal z animacją wejścia i wyjścia (odroczony unmount).
 * Użycie: <AnimatedModal open={flag} onClose={() => setFlag(false)}>…zawartość karty…</AnimatedModal>
 * Zawartość renderuje rodzic, więc pozostaje reaktywna na jego stan.
 * `cardClassName` — klasy karty (domyślnie wąska karta „card").
 */
export default function AnimatedModal({
  open,
  onClose,
  children,
  cardClassName = 'card max-w-xs w-full space-y-4 text-center',
  zClassName = 'z-50',
}) {
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
    } else if (visible) {
      setClosing(true);
      const t = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, EXIT_MS);
      return () => clearTimeout(t);
    }
  }, [open, visible]);

  if (!visible) return null;

  return (
    <div className={`fixed inset-0 ${zClassName} flex items-center justify-center p-4`}>
      <button
        type="button"
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={onClose}
        aria-label="Anuluj"
      />
      <div className={`relative ${cardClassName} ${closing ? 'animate-popup-out' : 'animate-popup-in'}`}>
        {children}
      </div>
    </div>
  );
}
