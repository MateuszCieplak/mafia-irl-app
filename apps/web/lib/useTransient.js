'use client';

import { useEffect, useRef, useState } from 'react';

// Moment ostatniego powrotu do karty/odblokowania ekranu. Zmiany stanu, które
// dochodzą z resynchronizacji tuż po powrocie, NIE są „nowym zdarzeniem” —
// inaczej komunikat znowu wyskakiwałby po każdym odblokowaniu telefonu.
let lastVisibleAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lastVisibleAt = Date.now();
  });
  window.addEventListener('pageshow', () => {
    lastVisibleAt = Date.now();
  });
}

const RESUME_GRACE_MS = 2500;

/**
 * Czasomierz komunikatu: zwraca `true` przez `ms` milisekund po każdej zmianie
 * `signal` (null/false/'' = brak komunikatu). Pierwsza wartość po zamontowaniu
 * oraz zmiany tuż po wybudzeniu ekranu są ignorowane — stałe informacje
 * gracz znajdzie w swoim dzienniku.
 */
export function useTransient(signal, ms = 6000) {
  const [shown, setShown] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    if (signal == null || signal === false || signal === '') {
      setShown(false);
      return undefined;
    }
    if (Date.now() - lastVisibleAt < RESUME_GRACE_MS) return undefined;
    setShown(true);
    const t = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(t);
  }, [signal, ms]);

  // Ukryj od razu przy wygaszeniu ekranu.
  useEffect(() => {
    const off = () => document.visibilityState === 'hidden' && setShown(false);
    document.addEventListener('visibilitychange', off);
    return () => document.removeEventListener('visibilitychange', off);
  }, []);

  return shown;
}
