'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';

export default function RoomInviteListener() {
  const { user } = useAuth();
  const { connected, on } = useSocket();
  const router = useRouter();
  const [invite, setInvite] = useState(null);

  useEffect(() => {
    if (!user || !connected) return;

    const offInvite = on('room_invite', (data) => {
      setInvite({
        roomCode: data.roomCode,
        fromUsername: data.fromUsername,
      });
    });

    const offKicked = on('kicked_from_room', () => {
      setInvite(null);
      router.push('/lobby');
      alert('Host usunął Cię z pokoju.');
    });

    const offClosed = on('room_closed', () => {
      setInvite(null);
      router.push('/lobby');
      alert('Host zamknął pokój.');
    });

    return () => {
      offInvite?.();
      offKicked?.();
      offClosed?.();
    };
  }, [user, connected, on, router]);

  if (!invite) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-lg rounded-2xl border border-town/40 bg-night/95 p-4 shadow-2xl backdrop-blur-md">
        <p className="text-sm text-white/80">
          <span className="font-semibold text-white">{invite.fromUsername}</span> zaprasza Cię do pokoju{' '}
          <span className="font-mono tracking-wider text-town">{invite.roomCode}</span>
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn-primary flex-1 text-sm"
            onClick={() => {
              const c = invite.roomCode;
              setInvite(null);
              router.push(`/room/${c}`);
            }}
          >
            Dołącz
          </button>
          <button
            type="button"
            className="btn-secondary flex-1 text-sm"
            onClick={() => setInvite(null)}
          >
            Odrzuć
          </button>
        </div>
      </div>
    </div>
  );
}
