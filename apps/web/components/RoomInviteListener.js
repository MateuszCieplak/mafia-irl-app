'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';

const EXIT_MS = 250;

export default function RoomInviteListener() {
  const { user } = useAuth();
  const { connected, on, emit } = useSocket();
  const router = useRouter();
  const [invite, setInvite] = useState(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Zamknięcie z animacją wyjścia; opcjonalny callback po odmontowaniu.
  const dismiss = useCallback(
    (after) => {
      clearCloseTimer();
      setClosing(true);
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null;
        setInvite(null);
        setClosing(false);
        after?.();
      }, EXIT_MS);
    },
    [clearCloseTimer]
  );

  // Natychmiastowe zamknięcie (np. wyrzucenie z pokoju) — bez animacji wyjścia.
  const hideNow = useCallback(() => {
    clearCloseTimer();
    setClosing(false);
    setInvite(null);
  }, [clearCloseTimer]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  useEffect(() => {
    if (!user || !connected) return;

    // Odświeżenie strony: serwer pamięta zaproszenia, więc blok wraca na ekran.
    emit('get_my_invites').then((res) => {
      const last = res?.ok && Array.isArray(res.invites) ? res.invites[res.invites.length - 1] : null;
      if (!last) return;
      setInvite((cur) =>
        cur ?? {
          roomCode: last.roomCode,
          fromUsername: last.fromUsername,
          key: `${last.roomCode}-${last.sentAt}`,
        },
      );
    });

    const offInvite = on('room_invite', (data) => {
      // Nowe zaproszenie w trakcie zamykania poprzedniego — anuluj zamknięcie.
      clearCloseTimer();
      setClosing(false);
      setInvite({
        roomCode: data.roomCode,
        fromUsername: data.fromUsername,
        // nowy klucz => animacja wejścia odpala się dla każdego zaproszenia
        key: `${data.roomCode}-${Date.now()}`,
      });
    });

    const offKicked = on('kicked_from_room', () => {
      hideNow();
      router.push('/lobby');
      alert('Host usunął Cię z pokoju.');
    });

    const offClosed = on('room_closed', () => {
      hideNow();
      router.push('/lobby');
      alert('Host zamknął pokój.');
    });

    return () => {
      offInvite?.();
      offKicked?.();
      offClosed?.();
    };
  }, [user, connected, on, emit, router, clearCloseTimer, hideNow]);

  if (!invite) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
      <div
        key={invite.key}
        role="alertdialog"
        aria-live="polite"
        className={`pointer-events-auto mx-auto max-w-lg rounded-2xl border border-brass-500/40 bg-night/95 p-4 shadow-2xl backdrop-blur-md ${
          closing ? 'animate-slide-out-bottom' : 'animate-slide-up-bounce'
        }`}
      >
        <p className="text-sm text-white/80">
          <span className="font-semibold text-white">{invite.fromUsername}</span> zaprasza Cię do pokoju{' '}
          <span className="font-mono tracking-wider text-brass-400">{invite.roomCode}</span>
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn-primary flex-1 text-sm"
            disabled={closing}
            onClick={() => {
              const c = invite.roomCode;
              router.push(`/room/${c}`);
              dismiss();
            }}
          >
            Dołącz
          </button>
          <button
            type="button"
            className="btn-secondary flex-1 text-sm"
            disabled={closing}
            onClick={() => {
              emit('decline_invite', { roomCode: invite.roomCode });
              dismiss();
            }}
          >
            Odrzuć
          </button>
        </div>
      </div>
    </div>
  );
}
