'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';
import PlayerList from '@/components/PlayerList';
import Chat from '@/components/Chat';
import RoomSettingsPanel from '@/components/RoomSettingsPanel';
import RoleAssignmentPanel from '@/components/RoleAssignmentPanel';

export default function RoomPage() {
  const { code } = useParams();
  const { user } = useAuth();
  const { emit, on, connected } = useSocket();
  const router = useRouter();
  const [players, setPlayers] = useState([]);
  const [joined, setJoined] = useState(false);
  const [onlineOthers, setOnlineOthers] = useState([]);
  const [copyHint, setCopyHint] = useState('');
  const [inviteHint, setInviteHint] = useState('');
  const [addingBot, setAddingBot] = useState(false);
  const [roomSettings, setRoomSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [roleAssignments, setRoleAssignments] = useState({});
  const [roomStatus, setRoomStatus] = useState(null);

  const minPlayers = 4;
  const isMaster = useMemo(
    () => Boolean(user?.id && players.some((p) => p.id === user.id && p.isMaster)),
    [user?.id, players]
  );
  const allOnline = players.length > 0 && players.every((p) => p.online !== false);
  const canStartGame = players.length >= minPlayers && allOnline;

  const refreshOnline = useCallback(async () => {
    const res = await emit('get_online_users');
    if (res?.ok && Array.isArray(res.users)) {
      setOnlineOthers(res.users);
    }
  }, [emit]);

  useEffect(() => {
    if (!connected) return;

    emit('join_room', { code }).then((res) => {
      if (res?.ok) {
        setPlayers(res.players || []);
        setJoined(true);
      }
    });

    emit('get_game_state', {}).then((res) => {
      if (res?.settings) setRoomSettings(res.settings);
      if (res?.status) setRoomStatus(res.status);
    });

    const syncPlayers = (list) => setPlayers(list || []);

    const offJoin = on('player_joined', (data) => {
      syncPlayers(data.players);
    });
    const offSync = on('room_players_sync', (data) => {
      syncPlayers(data.players);
    });
    const offLeave = on('player_left', (data) => {
      setPlayers((prev) => prev.filter((p) => p.id !== data.userId));
    });
    const offStart = on('game_started', () => {
      router.push(`/game/${code}`);
    });
    const offSettings = on('room_settings_updated', (data) => {
      if (data?.settings) setRoomSettings(data.settings);
    });

    return () => {
      offJoin?.();
      offSync?.();
      offLeave?.();
      offStart?.();
      offSettings?.();
    };
  }, [connected, code, user?.id, emit, on, router]);

  useEffect(() => {
    if (!joined || !connected) return;
    refreshOnline();
    const t = setInterval(refreshOnline, 6000);
    return () => clearInterval(t);
  }, [joined, connected, refreshOnline]);

  async function handleStartGame() {
    // Strip empty strings (= "random") from assignments before sending
    const overrides = Object.fromEntries(
      Object.entries(roleAssignments).filter(([, v]) => v),
    );
    const res = await emit('start_game', { roleOverrides: overrides });
    if (res?.ok) {
      // Przekierowanie nastąpi przez event 'game_started' wysłany przez serwer.
      // Jako fallback przekierowujemy tu, gdyby event nie dotarł (np. race condition).
      router.push(`/game/${code}`);
    } else {
      const errMap = {
        player_offline: 'Wszyscy gracze w pokoju muszą być online (mieć otwartą grę w przeglądarce).',
        not_enough_players: `Potrzeba co najmniej ${minPlayers} graczy w pokoju.`,
        no_room: 'Utracono połączenie z pokojem. Odśwież stronę i spróbuj ponownie.',
      };
      alert(errMap[res?.error] || res?.error || 'Nie można rozpocząć gry');
    }
  }

  async function handleSaveSettings(settings) {
    setSavingSettings(true);
    try {
      const res = await emit('update_room_settings', { settings });
      if (!res?.ok) {
        alert(res?.error || 'Nie udało się zapisać ustawień');
      } else if (res.settings) {
        setRoomSettings(res.settings);
      }
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleAddBot() {
    setAddingBot(true);
    try {
      const res = await emit('add_bot');
      if (!res?.ok) {
        const map = {
          not_master: 'Tylko host pokoju może dodawać boty.',
          not_in_lobby: 'Boty można dodawać tylko w lobby (przed startem).',
          no_room: 'Nie jesteś w pokoju.',
        };
        alert(map[res?.error] || res?.error || 'Nie udało się dodać bota');
      }
    } finally {
      setAddingBot(false);
    }
  }

  async function handleKickPlayer(targetUserId) {
    if (!window.confirm('Usunąć tego gracza z pokoju?')) return;
    const res = await emit('kick_player', { targetUserId });
    if (!res?.ok) {
      alert(res?.error === 'not_master' ? 'Tylko host może usuwać graczy.' : res?.error || 'Nie udało się usunąć gracza');
    }
  }

  async function copyInviteLink() {
    const path = `/room/${code}`;
    const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
    try {
      await navigator.clipboard.writeText(url);
      setCopyHint('Link skopiowany!');
      setTimeout(() => setCopyHint(''), 2500);
    } catch {
      setCopyHint('Skopiuj ręcznie: ' + url);
    }
  }

  async function copyCodeOnly() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyHint('Kod skopiowany!');
      setTimeout(() => setCopyHint(''), 2500);
    } catch {
      setCopyHint('');
    }
  }

  async function sendInvite(targetUserId) {
    setInviteHint('');
    const res = await emit('invite_to_room', { targetUserId });
    if (res?.ok) {
      setInviteHint('Zaproszenie wysłane');
      setTimeout(() => setInviteHint(''), 2500);
    } else {
      const map = {
        user_offline: 'Ten gracz nie ma teraz otwartej aplikacji.',
        not_in_room: 'Musisz być w pokoju, żeby zapraszać.',
        not_master: 'Tylko host może wysyłać zaproszenia z aplikacji.',
        not_connected: 'Brak połączenia z serwerem — odśwież stronę.',
      };
      setInviteHint(map[res?.error] || res?.error || 'Nie udało się wysłać zaproszenia');
      setTimeout(() => setInviteHint(''), 4000);
    }
  }

  const playerIds = new Set(players.map((p) => p.id));
  const inviteCandidates = onlineOthers.filter((u) => !playerIds.has(u.id));

  if (!joined) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40">
        Dołączanie do pokoju...
      </div>
    );
  }

  // Gracz wrócił tu przez przypadek (np. przycisk "wstecz" w przeglądarce),
  // a gra wciąż się toczy — pokazujemy jasny komunikat i przycisk powrotu do rozgrywki
  // zamiast pustego widoku lobby.
  if (!isMaster && roomStatus === 'in_progress') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-4">
        <span className="text-4xl">🎭</span>
        <h2 className="font-display text-xl font-bold">Gra wciąż się toczy!</h2>
        <p className="text-white/50 text-sm max-w-xs">
          Wyszedłeś(aś) z ekranu rozgrywki, ale gra jeszcze nie skończyła się. Dołącz z powrotem, aby nie
          przegapić kolejnych faz.
        </p>
        <button
          type="button"
          onClick={() => router.push(`/game/${code}`)}
          className="btn-primary"
        >
          Wróć do rozgrywki
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold">Pokój</h2>
          <p className="font-mono text-2xl font-bold tracking-[0.2em] text-town">{code}</p>
          <p className="text-white/40 text-xs">{players.length} graczy w pokoju</p>
        </div>
        {isMaster && (
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddBot}
                disabled={addingBot}
                className="btn-secondary text-sm disabled:opacity-40 disabled:pointer-events-none"
                title="Dodaj bota-gracza (tylko do testów przebiegu gry)"
              >
                {addingBot ? 'Dodaję...' : '+ Dodaj bota'}
              </button>
              <button
                type="button"
                onClick={handleStartGame}
                disabled={!canStartGame}
                className="btn-primary text-sm disabled:opacity-40 disabled:pointer-events-none"
              >
                Rozpocznij grę
              </button>
            </div>
            {!canStartGame ? (
              <p className="text-[12px] text-white/40 text-right max-w-[14rem]">
                {players.length < minPlayers
                  ? `Minimum ${minPlayers} graczy w pokoju, żeby wystartować.`
                  : !allOnline
                    ? 'Wszyscy ludzcy gracze muszą być online, żeby wystartować.'
                    : null}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="p-4 space-y-3 border-b border-white/10 bg-white/[0.03]">
        <p className="text-xs text-white/50 uppercase tracking-wide">Zaproś znajomych</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyInviteLink} className="btn-town text-sm">
            Skopiuj link do pokoju
          </button>
          <button type="button" onClick={copyCodeOnly} className="btn-secondary text-sm">
            Skopiuj sam kod
          </button>
        </div>
        {copyHint ? <p className="text-safe text-xs">{copyHint}</p> : null}
        <p className="text-white/35 text-xs leading-relaxed">
          Zalogowani znajomi mogą dołączyć kodem z lobby. Zaproszenie w aplikacji może wysłać tylko host pokoju
          (gracze muszą mieć otwartą grę w przeglądarce).
        </p>
      </div>

      {isMaster && inviteCandidates.length > 0 && (
        <div className="px-4 py-3 border-b border-white/10">
          <p className="text-xs text-white/50 uppercase tracking-wide mb-2">Gracze online (zaproś do pokoju)</p>
          <ul className="space-y-2">
            {inviteCandidates.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{u.username || u.id.slice(0, 8)}</p>
                  {u.inRoomCode ? (
                    <p className="text-[12px] text-white/35">W pokoju {u.inRoomCode}</p>
                  ) : (
                    <p className="text-[12px] text-white/35">W lobby</p>
                  )}
                </div>
                <button type="button" onClick={() => sendInvite(u.id)} className="btn-primary text-xs shrink-0 px-3 py-2">
                  Zaproś
                </button>
              </li>
            ))}
          </ul>
          {inviteHint ? <p className="text-xs mt-2 text-white/60">{inviteHint}</p> : null}
        </div>
      )}

      {isMaster && players.filter((p) => !p.isMaster).length > 0 && (
        <div className="px-4 py-3 border-b border-white/10">
          <RoleAssignmentPanel
            players={players.filter((p) => !p.isMaster)}
            assignments={roleAssignments}
            onChange={setRoleAssignments}
          />
        </div>
      )}

      <div className="flex flex-col md:flex-row border-b border-white/10">
        {isMaster && (
          <div className="flex-1 px-4 py-3 border-b border-white/10 md:border-b-0 md:border-r md:border-white/10">
            <RoomSettingsPanel
              settings={roomSettings}
              onSave={handleSaveSettings}
              saving={savingSettings}
            />
          </div>
        )}
        <div className="flex-1 p-4">
          <p className="text-xs text-white/40 mb-2">W pokoju</p>
          <p className="text-[12px] text-white/30 mb-2">
            Kropka przy awatarze: zielona — okno gry otwarte, szara — rozłączony (np. zamknięta przeglądarka).
          </p>
          <PlayerList
            players={players}
            showPresence
            masterCanKick={isMaster}
            currentUserId={user?.id}
            onKickPlayer={handleKickPlayer}
            gridLayout
          />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <Chat channel="lobby" roomCode={code} />
      </div>
    </div>
  );
}
