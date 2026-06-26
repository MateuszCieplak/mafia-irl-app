'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';

const ROOM_HOST_EMAIL = (
  process.env.NEXT_PUBLIC_ROOM_HOST_EMAIL || 'm.cieplak97@gmail.com'
)
  .trim()
  .toLowerCase();

export default function LobbyPage() {
  const { user, logout } = useAuth();
  const { emit, connected } = useSocket();
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const canCreateRoom = useMemo(() => {
    const e = (user?.email || '').trim().toLowerCase();
    return e === ROOM_HOST_EMAIL;
  }, [user?.email]);

  async function handleCreate() {
    if (!canCreateRoom) return;
    setCreating(true);
    setError('');
    const res = await emit('create_room', {});
    if (res?.ok) {
      router.push(`/room/${res.code}`);
    } else {
      const msg =
        res?.error === 'forbidden_create_room'
          ? 'Tylko organizator może tworzyć pokoje.'
          : res?.error || 'Nie udało się utworzyć pokoju';
      setError(msg);
    }
    setCreating(false);
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoining(true);
    setError('');
    const res = await emit('join_room', { code: joinCode.trim().toUpperCase() });
    if (res?.ok) {
      router.push(`/room/${joinCode.trim().toUpperCase()}`);
    } else {
      setError(res?.error || 'Nie znaleziono pokoju');
    }
    setJoining(false);
  }

  return (
    <div className="flex-1 flex flex-col px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold">MAFIA</h1>
          <p className="text-white/40 text-sm">{user?.username || user?.email}</p>
        </div>
        <button onClick={logout} className="btn-secondary text-xs">
          Wyloguj
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-sm mx-auto w-full">
        {canCreateRoom ? (
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !connected}
            className="btn-primary w-full text-lg"
          >
            {creating ? 'Tworzenie...' : 'Utwórz pokój'}
          </button>
        ) : (
          <div className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white/50">
            Tylko organizator może utworzyć pokój. Dołącz kodem wysłanym przez hosta.
          </div>
        )}

        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-white/30 text-xs uppercase tracking-wider">lub</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <form onSubmit={handleJoin} className="w-full space-y-3">
          <input
            type="text"
            placeholder="Kod pokoju"
            className="input text-center text-lg tracking-[0.3em] uppercase"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            maxLength={5}
          />
          <button
            type="submit"
            disabled={joining || !connected || !joinCode.trim()}
            className="btn-town w-full"
          >
            {joining ? 'Dołączanie...' : 'Dołącz'}
          </button>
        </form>

        {error && <p className="text-blood text-sm text-center">{error}</p>}

        <p className="text-white/30 text-xs text-center max-w-xs">
          Żeby znajomi dołączyli: wyślij im <strong className="text-white/50">link</strong> lub{' '}
          <strong className="text-white/50">kod pokoju</strong> z ekranu pokoju albo użyj{' '}
          <strong className="text-white/50">Zaproś</strong> przy graczach online (muszą być zalogowani w aplikacji).
        </p>

        {!connected && (
          <p className="text-yellow-500/60 text-xs text-center">
            Łączenie z serwerem...
          </p>
        )}
      </div>
    </div>
  );
}
