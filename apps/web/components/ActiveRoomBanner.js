'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';

const DISMISS_KEY = 'activeRoomDismissed';

const COPY = {
  in_progress: {
    icon: '🎭',
    title: 'Jesteś w trakcie gry',
    text: (code) => `Gra w pokoju ${code} wciąż trwa. Wróć, żeby nie przegapić kolejnej fazy.`,
    primary: 'Wróć do gry',
    secondary: 'Później',
  },
  lobby: {
    icon: '🚪',
    title: 'Czekasz w pokoju',
    text: (code) => `Nadal jesteś na liście graczy pokoju ${code}.`,
    primary: 'Wróć do pokoju',
    secondary: 'Opuść pokój',
  },
  finished: {
    icon: '🏁',
    title: 'Gra zakończona',
    text: (code) => `Gra w pokoju ${code} dobiegła końca. Zobacz podsumowanie albo wróć do pokoju.`,
    primary: 'Zobacz wynik',
    secondary: 'Zamknij',
  },
};

// „Później” przy trwającej grze działa do zamknięcia przeglądarki (sessionStorage) —
// po ponownym otwarciu Chrome komunikat ma wrócić. Zamknięty baner zakończonej
// gry nie wraca wcale (localStorage).
function storeFor(status) {
  try {
    return status === 'finished' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function isDismissed(r) {
  try {
    return storeFor(r.status)?.getItem(DISMISS_KEY) === `${r.code}:${r.status}`;
  } catch {
    return false;
  }
}

function writeDismissed(r) {
  try {
    storeFor(r.status)?.setItem(DISMISS_KEY, `${r.code}:${r.status}`);
  } catch {
    /* brak storage — baner wróci po odświeżeniu */
  }
}

/**
 * Gracz zamknął Chrome / aplikację w trakcie gry, a potem otworzył stronę od
 * nowa (zwykle ląduje w lobby). Serwer wie, że nadal jest uczestnikiem pokoju —
 * pokazujemy wyraźny komunikat z powrotem do gry.
 */
export default function ActiveRoomBanner() {
  const { user } = useAuth();
  const { connected, emit } = useSocket();
  const pathname = usePathname() || '';
  const router = useRouter();
  const [room, setRoom] = useState(null);
  const [busy, setBusy] = useState(false);

  // Na stronie tego samego pokoju / gry baner nie ma sensu.
  const onRoomPage = /^\/(room|game)\//.test(pathname);
  const onAuthPage = /^\/(login|register|enter-password)/.test(pathname);

  const check = useCallback(async () => {
    const res = await emit('get_my_active_room', {}, { timeoutMs: 5000 });
    const r = res?.ok ? res.room : null;
    if (!r || isDismissed(r)) {
      setRoom(null);
      return;
    }
    setRoom(r);
  }, [emit]);

  useEffect(() => {
    if (!user || !connected || onRoomPage || onAuthPage) {
      setRoom(null);
      return;
    }
    check();
  }, [user, connected, onRoomPage, onAuthPage, check]);

  if (!room || onRoomPage) return null;
  const copy = COPY[room.status] || COPY.lobby;

  function goBack() {
    const target = room.status === 'lobby' ? `/room/${room.code}` : `/game/${room.code}`;
    setRoom(null);
    router.push(target);
  }

  async function secondary() {
    if (room.status === 'lobby' && !room.isMaster) {
      setBusy(true);
      await emit('leave_room', { code: room.code });
      setBusy(false);
    } else {
      writeDismissed(room);
    }
    setRoom(null);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" aria-hidden />
      <div
        role="alertdialog"
        aria-labelledby="active-room-title"
        className="relative w-full max-w-sm rounded-2xl border border-brass-500/40 bg-ink-800/95 p-5 shadow-2xl animate-slide-up-bounce text-center space-y-3"
      >
        <span className="text-3xl" aria-hidden>
          {copy.icon}
        </span>
        <h2 id="active-room-title" className="font-display text-lg font-bold">
          {copy.title}
        </h2>
        <p className="text-sm text-paper-200/70">{copy.text(room.code)}</p>
        <div className="flex flex-col gap-2 pt-1">
          <button type="button" className="btn-primary w-full" onClick={goBack}>
            {copy.primary}
          </button>
          <button type="button" className="btn-ghost w-full" onClick={secondary} disabled={busy}>
            {room.status === 'lobby' && room.isMaster ? 'Później' : copy.secondary}
          </button>
        </div>
      </div>
    </div>
  );
}
