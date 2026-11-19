'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';
import PlayerList from '@/components/PlayerList';
import Chat from '@/components/Chat';
import RoomSettingsPanel, {
  mergeSettings,
  sanitizeSettings,
  settingsDiffer,
} from '@/components/RoomSettingsPanel';
import RoleAssignmentPanel from '@/components/RoleAssignmentPanel';
import AnimatedModal from '@/components/AnimatedModal';
import { computeRoleLimits } from '@/lib/roleLimits';

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
  // Stan roboczy ustawień (edytowany w panelu) — porównywany z zapisanym na serwerze.
  const [draftSettings, setDraftSettings] = useState(null);
  const syncedSettingsRef = useRef(null);
  const [saveToast, setSaveToast] = useState('');
  const [roleAssignments, setRoleAssignments] = useState({});
  const [roomStatus, setRoomStatus] = useState(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closingRoom, setClosingRoom] = useState(false);
  const [tab, setTab] = useState('players');

  const minPlayers = 4;
  const isMaster = useMemo(
    () => Boolean(user?.id && players.some((p) => p.id === user.id && p.isMaster)),
    [user?.id, players]
  );
  const allOnline = players.length > 0 && players.every((p) => p.online !== false);
  const canStartGame = players.length >= minPlayers && allOnline;

  const settingsDirty = Boolean(
    draftSettings && roomSettings && settingsDiffer(draftSettings, roomSettings),
  );

  // Nowe ustawienia z serwera nadpisują szkic tylko wtedy, gdy master nie ma
  // niezapisanych zmian — inaczej cudzy/własny zapis wymazałby jego edycję.
  useEffect(() => {
    if (!roomSettings) return;
    setDraftSettings((prev) => {
      const wasClean = !prev || !syncedSettingsRef.current || !settingsDiffer(prev, syncedSettingsRef.current);
      syncedSettingsRef.current = roomSettings;
      return wasClean ? mergeSettings(roomSettings) : prev;
    });
  }, [roomSettings]);

  // Ostrzeżenie przy zamykaniu karty z niezapisanymi ustawieniami.
  useEffect(() => {
    if (!settingsDirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [settingsDirty]);

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
    const offReset = on('room_reset_to_lobby', (data) => {
      setRoomStatus('lobby');
      if (data?.players) setPlayers(data.players);
    });

    return () => {
      offJoin?.();
      offSync?.();
      offLeave?.();
      offStart?.();
      offSettings?.();
      offReset?.();
    };
  }, [connected, code, user?.id, emit, on, router]);

  useEffect(() => {
    if (!joined || !connected) return;
    refreshOnline();
    const t = setInterval(refreshOnline, 6000);
    return () => clearInterval(t);
  }, [joined, connected, refreshOnline]);

  async function handleStartGame() {
    // Serwer startuje z ZAPISANYCH ustawień — nie pozwalamy po cichu zgubić zmian.
    if (settingsDirty) {
      const saveFirst = window.confirm(
        'Masz niezapisane zmiany w ustawieniach.\n\nOK — zapisz je i rozpocznij grę.\nAnuluj — wróć do ustawień.',
      );
      if (!saveFirst) {
        setTab('settings');
        return;
      }
      const ok = await handleSaveSettings();
      if (!ok) return;
    }
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
        role_limit_exceeded: `Przekroczono limit ról (${{ mafia: 'mafia', detective: 'detektywów', doctor: 'lekarzy' }[res?.role] || res?.role}: max ${res?.limit}). Popraw przypisania w zakładce „Role” lub zmień ustawienia.`,
      };
      alert(errMap[res?.error] || res?.error || 'Nie można rozpocząć gry');
    }
  }

  async function handleSaveSettings() {
    if (!draftSettings) return false;
    const settings = sanitizeSettings(
      draftSettings,
      players.filter((p) => !p.isMaster).length,
    );
    setSavingSettings(true);
    try {
      const res = await emit('update_room_settings', { settings });
      if (!res?.ok) {
        alert(res?.error || 'Nie udało się zapisać ustawień');
        return false;
      }
      const saved = res.settings || settings;
      setRoomSettings(saved);
      // Szkic = to, co faktycznie zapisano (po przycięciu liczb).
      syncedSettingsRef.current = saved;
      setDraftSettings(mergeSettings(saved));
      setSaveToast('Ustawienia zapisane ✓');
      setTimeout(() => setSaveToast(''), 2500);
      return true;
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

  function handleLeaveRoom() {
    emit('leave_room');
    router.push('/lobby');
  }

  async function handleCloseRoom() {
    setClosingRoom(true);
    try {
      const res = await emit('close_room');
      if (res?.ok) {
        router.push('/lobby');
      } else {
        alert(res?.error === 'not_master' ? 'Tylko host może zamknąć pokój.' : res?.error || 'Nie udało się zamknąć pokoju');
      }
    } finally {
      setClosingRoom(false);
      setShowCloseConfirm(false);
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
      refreshOnline();
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

  async function sendInviteAll() {
    setInviteHint('');
    const res = await emit('invite_all');
    if (res?.ok) {
      setInviteHint(
        res.sent > 0
          ? `Wysłano zaproszenia: ${res.sent}`
          : 'Wszyscy gracze online już dostali zaproszenie.',
      );
      setTimeout(() => setInviteHint(''), 3000);
      refreshOnline();
    } else {
      const map = {
        not_in_room: 'Musisz być w pokoju, żeby zapraszać.',
        not_master: 'Tylko host może wysyłać zaproszenia z aplikacji.',
        not_connected: 'Brak połączenia z serwerem — odśwież stronę.',
      };
      setInviteHint(map[res?.error] || res?.error || 'Nie udało się wysłać zaproszeń');
      setTimeout(() => setInviteHint(''), 4000);
    }
  }

  const hostPlayers = players.filter((p) => p.isMaster);
  const guestPlayers = players.filter((p) => !p.isMaster);
  const roleLimits = computeRoleLimits(roomSettings, guestPlayers.length);
  const roleHints = Object.fromEntries(guestPlayers.map((p) => [p.id, roleAssignments[p.id] || '']));
  const playerIds = new Set(players.map((p) => p.id));
  const inviteCandidates = onlineOthers.filter((u) => !playerIds.has(u.id));

  if (!joined) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40 animate-fade-in">
        <span className="animate-pulse-soft">Dołączanie do pokoju...</span>
      </div>
    );
  }

  // Gracz wrócił tu przez przypadek (np. przycisk "wstecz" w przeglądarce),
  // a gra wciąż się toczy — pokazujemy jasny komunikat i przycisk powrotu do rozgrywki
  // zamiast pustego widoku lobby.
  if (!isMaster && roomStatus === 'in_progress') {
    return (
      <div className="stagger flex-1 flex flex-col items-center justify-center text-center px-6 gap-4">
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

  const tabs = [
    { id: 'players', label: 'Gracze', icon: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 21a8 8 0 0 1 16 0', badge: players.length },
    { id: 'invite', label: 'Zaproś', icon: 'M12 5v14M5 12h14' },
    ...(isMaster
      ? [
          { id: 'roles', label: 'Role', icon: 'M4 4h16v16H4zM9 9h6M9 13h6' },
          { id: 'settings', label: 'Ustawienia', icon: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4' },
        ]
      : []),
    { id: 'chat', label: 'Czat', icon: 'M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'players';
  const sectionMeta = {
    players: ['Lista obecności', 'Gracze w pokoju'],
    invite: ['Rekrutacja', 'Zaproś graczy'],
    roles: ['Rozdanie kart', 'Przypisanie ról'],
    settings: ['Zasady gry', 'Ustawienia pokoju'],
    chat: ['Narada', 'Czat pokoju'],
  }[activeTab];
  const startHint = !isMaster
    ? null
    : players.length < minPlayers
      ? `Min. ${minPlayers} graczy`
      : !allOnline
        ? 'Czekam na wszystkich online'
        : null;

  return (
    <div className="room-shell h-dvh flex flex-col overflow-hidden">
      <header className="room-header animate-fade-in">
        <button
          type="button"
          onClick={() => setShowLeaveConfirm(true)}
          aria-label="Powrót do głównego ekranu"
          title="Powrót do głównego ekranu"
          className="shrink-0 rounded-lg p-2 text-paper-200/60 hover:text-paper-100 hover:bg-white/5 transition-colors"
        >
          <Icon d="M15 18l-6-6 6-6" />
        </button>
        <button type="button" onClick={copyCodeOnly} className="paper-ticket animate-scale-in [animation-delay:150ms]" title="Skopiuj kod">
          {code}
        </button>
        <div className="min-w-0 flex-1">
          <p className="section-eyebrow">Pokój</p>
          <p key={copyHint ? 'hint' : 'count'} className="text-xs text-paper-200/50 truncate animate-fade-in">
            {copyHint || `${players.length} ${players.length === 1 ? 'gracz' : 'graczy'}`}
          </p>
        </div>
        {isMaster && (
          <div className="flex items-center gap-2 shrink-0">
            {settingsDirty ? (
              <span className="hidden lg:block text-xs text-amber-300/90 animate-fade-in">
                Niezapisane zmiany!
              </span>
            ) : saveToast ? (
              <span key={saveToast} className="hidden lg:block text-xs text-safe animate-fade-up">
                {saveToast}
              </span>
            ) : (
              startHint && <span className="hidden sm:block text-xs text-paper-200/50">{startHint}</span>
            )}
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={!settingsDirty || savingSettings}
              title={settingsDirty ? 'Masz niezapisane zmiany w ustawieniach' : 'Ustawienia są zapisane'}
              className={`btn-save !min-h-[40px] !px-3 ${settingsDirty ? 'is-dirty' : ''}`}
            >
              {savingSettings ? 'Zapisuję…' : settingsDirty ? '● Zapisz ustawienia' : 'Zapisano ✓'}
            </button>
            <button
              type="button"
              onClick={handleStartGame}
              disabled={!canStartGame}
              className="btn-primary !min-h-[40px] !px-4"
            >
              Rozpocznij grę
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <nav className="animate-slide-in-left [animation-delay:100ms] hidden md:flex w-56 shrink-0 flex-col gap-1 border-r border-brass-500/20 bg-ink-900/60 p-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className="nav-item"
              aria-current={activeTab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              <Icon d={t.icon} />
              <span className="flex-1 text-left">{t.label}</span>
              {t.badge != null && <span className="text-xs opacity-60">{t.badge}</span>}
            </button>
          ))}
        </nav>

        <main className="flex-1 min-h-0 min-w-0 flex flex-col">
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/5">
            <div key={activeTab} className="max-w-3xl mx-auto w-full flex items-end justify-between gap-3 animate-fade-up">
              <div className="min-w-0">
                <p className="section-eyebrow">{sectionMeta[0]}</p>
                <h2 className="font-display text-xl font-bold text-paper-100">{sectionMeta[1]}</h2>
              </div>
              {activeTab === 'players' && isMaster && (
                <button
                  type="button"
                  onClick={handleAddBot}
                  disabled={addingBot}
                  className="btn-secondary text-sm shrink-0"
                  title="Dodaj bota-gracza (tylko do testów przebiegu gry)"
                >
                  {addingBot ? 'Dodaję...' : '+ Dodaj bota'}
                </button>
              )}
            </div>
          </div>

          {activeTab === 'chat' ? (
            <div key="chat" className="flex-1 min-h-0 max-w-3xl mx-auto w-full animate-fade-in">
              <Chat channel="lobby" roomCode={code} />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              <div key={activeTab} className="max-w-3xl mx-auto w-full p-4 space-y-4 animate-fade-up">
                {activeTab === 'players' && (
                  <>
                    <p className="text-xs text-paper-200/50">
                      Zielona kropka — okno gry otwarte, szara — rozłączony.
                    </p>
                    {hostPlayers.length > 0 && (
                      <section className="space-y-2">
                        <p className="section-eyebrow">Host</p>
                        <PlayerList
                          players={hostPlayers}
                          showPresence
                          currentUserId={user?.id}
                          gridLayout
                        />
                      </section>
                    )}
                    <section className="space-y-2">
                      <p className="section-eyebrow">Gracze ({guestPlayers.length})</p>
                      {guestPlayers.length === 0 ? (
                        <p className="text-sm text-white/35">Nikt jeszcze nie dołączył.</p>
                      ) : (
                        /* stagger-deep: karty graczy wjeżdżają kolejno; nowy gracz (nowy key) animuje się sam */
                        <div className="stagger-deep">
                          <PlayerList
                            players={guestPlayers}
                            showPresence
                            masterCanKick={isMaster}
                            currentUserId={user?.id}
                            onKickPlayer={handleKickPlayer}
                            roleHints={isMaster ? roleHints : null}
                            gridLayout
                          />
                        </div>
                      )}
                    </section>
                  </>
                )}

                {activeTab === 'invite' && (
                  <>
                    <div className="panel space-y-3">
                      <p className="text-sm text-paper-100/80">Wyślij znajomym link lub sam kod pokoju.</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={copyInviteLink} className="btn-town text-sm">
                          Skopiuj link do pokoju
                        </button>
                        <button type="button" onClick={copyCodeOnly} className="btn-secondary text-sm">
                          Skopiuj sam kod
                        </button>
                      </div>
                      {copyHint ? <p key={copyHint} className="text-safe text-xs animate-fade-up">{copyHint}</p> : null}
                      <p className="text-xs text-white/40 leading-relaxed">
                        Zalogowani znajomi mogą dołączyć kodem z lobby. Zaproszenie w aplikacji może wysłać
                        tylko host (gracz musi mieć otwartą grę w przeglądarce).
                      </p>
                    </div>

                    {isMaster && (
                      <div className="space-y-2">
                        <p className="section-eyebrow">Online ({inviteCandidates.length})</p>
                        <button
                          type="button"
                          onClick={sendInviteAll}
                          disabled={inviteCandidates.every((u) => u.invited)}
                          className="btn-primary text-sm w-full"
                        >
                          Wyślij zaproszenia do wszystkich
                        </button>
                        {inviteCandidates.length === 0 ? (
                          <p className="text-sm text-white/35">Nikt inny nie jest teraz online.</p>
                        ) : (
                          <ul className="space-y-2 stagger [--stagger-step:40ms]">
                            {inviteCandidates.map((u) => (
                              <li
                                key={u.id}
                                className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{u.username || u.id.slice(0, 8)}</p>
                                  <p className="text-xs text-white/35">
                                    {u.inRoomCode ? `W pokoju ${u.inRoomCode}` : 'W lobby'}
                                  </p>
                                  {u.invited && (
                                    <p className="text-xs text-safe">✓ Ten gracz dostał zaproszenie</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => sendInvite(u.id)}
                                  className="btn-primary text-xs shrink-0 !px-3 !py-2 !min-h-[40px]"
                                >
                                  Zaproś
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {inviteHint ? <p key={inviteHint} className="text-xs text-white/60 animate-fade-up">{inviteHint}</p> : null}
                      </div>
                    )}
                  </>
                )}

                {activeTab === 'roles' && isMaster && (
                  players.filter((p) => !p.isMaster).length > 0 ? (
                    <RoleAssignmentPanel
                      players={players.filter((p) => !p.isMaster)}
                      assignments={roleAssignments}
                      onChange={setRoleAssignments}
                      limits={roleLimits}
                    />
                  ) : (
                    <p className="text-sm text-white/35">Brak graczy do przypisania ról.</p>
                  )
                )}

                {activeTab === 'settings' && isMaster && (
                  <>
                    {settingsDirty && (
                      <div
                        role="status"
                        className="rounded-lg border border-amber-300/50 bg-amber-400/10 px-3 py-2 text-xs text-amber-200 animate-fade-in"
                      >
                        Masz niezapisane zmiany — kliknij „Zapisz ustawienia” u góry, zanim rozpoczniesz grę.
                      </div>
                    )}
                    {draftSettings && (
                      <RoomSettingsPanel
                        value={draftSettings}
                        onChange={setDraftSettings}
                        playerCount={players.filter((p) => !p.isMaster).length}
                        dangerZone={
                          <div className="panel border-red-500/30 space-y-2">
                            <p className="section-eyebrow !text-red-400/80">Strefa niebezpieczna</p>
                            <p className="text-xs text-white/45">
                              Trwale zamyka pokój i wyrzuca wszystkich graczy.
                            </p>
                            <button
                              type="button"
                              onClick={() => setShowCloseConfirm(true)}
                              className="text-red-400/80 hover:text-red-400 text-sm font-semibold transition-colors"
                            >
                              Zabij pokój
                            </button>
                          </div>
                        }
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </main>

        <nav
          className="animate-slide-in-bottom [animation-delay:150ms] md:hidden shrink-0 grid border-t border-brass-500/25 bg-ink-900/95"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tab-item"
              aria-current={activeTab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              <Icon d={t.icon} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <AnimatedModal open={showLeaveConfirm} onClose={() => setShowLeaveConfirm(false)}>
            <h3 className="font-display text-lg font-bold">Opuścić pokój?</h3>
            <p className="text-white/50 text-sm">
              {isMaster
                ? 'Pokój zostanie zachowany — możesz do niego wrócić tym samym kodem.'
                : 'Możesz dołączyć ponownie tym samym kodem.'}
            </p>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={handleLeaveRoom} className="btn-primary w-full">
                Wróć do głównego ekranu
              </button>
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="text-white/30 hover:text-white/60 text-sm py-1 transition-colors"
              >
                Anuluj
              </button>
            </div>
      </AnimatedModal>

      <AnimatedModal open={showCloseConfirm} onClose={() => setShowCloseConfirm(false)}>
            <h3 className="font-display text-lg font-bold">Zabić pokój?</h3>
            <p className="text-white/50 text-sm">
              Pokój zostanie trwale zamknięty, a wszyscy gracze zostaną wyrzuceni do głównego ekranu. Tej
              operacji nie da się cofnąć.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleCloseRoom}
                disabled={closingRoom}
                className="w-full px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {closingRoom ? 'Zamykam...' : 'Zabij pokój'}
              </button>
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="text-white/30 hover:text-white/60 text-sm py-1 transition-colors"
              >
                Anuluj
              </button>
            </div>
      </AnimatedModal>
    </div>
  );
}

function Icon({ d }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
