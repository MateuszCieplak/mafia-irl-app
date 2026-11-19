'use client';

import { useEffect, useState } from 'react';
import Chat from '@/components/Chat';
import { useSocket } from '@/lib/useSocket';
import { useAuth } from '@/lib/AuthContext';

/**
 * „Dziupla Mafii” — przycisk na dole ekranu, który rozwija czat mafii jako
 * dropdown (zamiast sztywnego bloku zasłaniającego wybór akcji). Gdy czat jest
 * zamknięty, licznik pokazuje, ile wiadomości od innych jeszcze nie widziałeś(aś).
 * Czat jest montowany tylko po otwarciu; licznik liczy własny nasłuch eventu.
 */
export default function MafiaChatDrawer({
  channel,
  roomCode,
  readOnly = false,
  label = 'Dziupla Mafii',
  className = '',
  panelClassName = 'h-[50dvh] max-h-[26rem]',
}) {
  const { on, connected } = useSocket();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!connected || !channel) return;
    const off = on('chat_message', (msg) => {
      if (msg.channel !== channel) return;
      if (msg.userId === user?.id) return;
      setUnread((n) => (open ? 0 : n + 1));
    });
    return off;
  }, [on, connected, channel, user?.id, open]);

  function toggle() {
    setOpen((o) => !o);
    setUnread(0);
  }

  return (
    <div className={`relative ${className}`}>
      {open && (
        <div
          className={`absolute bottom-full inset-x-0 z-50 mb-1 flex flex-col overflow-hidden rounded-xl border border-brass-500/30 bg-ink-900/95 backdrop-blur shadow-[0_-10px_30px_rgba(0,0,0,0.5)] animate-slide-in-bottom ${panelClassName}`}
        >
          <div className="flex-1 min-h-0">
            <Chat channel={channel} roomCode={roomCode} readOnly={readOnly} />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="relative z-50 w-full flex items-center justify-between gap-2 rounded-xl border border-brass-500/30 bg-ink-800/90 px-4 py-3 text-sm font-semibold uppercase tracking-wider text-paper-100 transition active:scale-[0.99] hover:border-brass-400/60"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden>🔫</span>
          {label}
        </span>
        <span className="flex items-center gap-2">
          {!open && unread > 0 && (
            <span
              key={unread}
              className="animate-badge-pop min-w-[1.5rem] rounded-full bg-blood px-2 py-0.5 text-center text-xs font-bold text-white"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
          <span aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`}>▲</span>
        </span>
      </button>
    </div>
  );
}
