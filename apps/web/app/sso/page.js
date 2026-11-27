'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import pb from '@/lib/pocketbase';
import BrandHeader from '@/components/BrandHeader';

const PANEL_URL = process.env.NEXT_PUBLIC_SIEJE_PANEL_URL || process.env.SIEJE_PANEL_URL || '';

export default function SsoPage() {
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const ticket = params.get('t');
    // Bilet znika z paska adresu od razu, żeby nie został w historii ani w zrzutach ekranu.
    window.history.replaceState(null, '', '/sso');

    if (!ticket) {
      setError('Brak linku logowania. Wróć do panelu i kliknij „Dołącz do gry”.');
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ t: ticket }),
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token || !data.record) {
          setError(data.error || 'Nie udało się zalogować przez panel.');
          return;
        }
        pb.authStore.save(data.token, data.record);
        window.location.replace('/lobby');
      } catch {
        setError('Nie udało się połączyć z grą. Spróbuj ponownie.');
      }
    })();
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <BrandHeader subtitle="Logowanie przez panel Sieje…" />
      {error ? (
        <div className="auth-card space-y-4 animate-scale-in text-center">
          <p className="text-blood text-sm">{error}</p>
          <Link href="/login" className="btn-primary w-full block text-center">
            Zaloguj się normalnie
          </Link>
          {PANEL_URL && (
            <a
              href={`${PANEL_URL.replace(/\/$/, '')}/sieje/mafia/graj`}
              className="block text-brass-400 underline underline-offset-4 hover:text-paper-100 text-sm"
            >
              Wróć do panelu
            </a>
          )}
        </div>
      ) : (
        <p className="text-paper-200/60 text-sm animate-pulse-soft">Chwileczkę…</p>
      )}
    </div>
  );
}
