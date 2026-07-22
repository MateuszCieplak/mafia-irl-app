'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';
import GameMenu from '@/components/GameMenu';
import TurnTimer from '@/components/TurnTimer';
import PhaseBadge from '@/components/PhaseBadge';
import NightActionPicker from '@/components/NightActionPicker';
import VotePanel from '@/components/VotePanel';
import MasterControls from '@/components/MasterControls';
import MasterInsightFeed from '@/components/MasterInsightFeed';
import Chat from '@/components/Chat';
import VerdictReveal from '@/components/VerdictReveal';
import PlayerList from '@/components/PlayerList';
import { ROLE_LABELS, ROLE_COLORS, ROLE_BG } from '@/lib/roleTheme';

const PHASE_FLAVOR = {
  null: 'Zapada noc…',
  night_detective: 'Detektyw sprawdza podejrzanego…',
  night_doctor: 'Lekarz chroni wybraną osobę…',
  night_mafia: 'Mafia naradza się w cieniu…',
  night_resolve: 'Noc dobiega końca…',
  day_deliberation: 'Czas na dyskusję',
  day_vote: 'Czas głosowania',
  day_resolve: 'Rozstrzygnięcie głosowania…',
};

const ACTION_WAITING = {
  night_detective: 'Informacja przekazana masterowi…',
  night_doctor: 'Ochrona aktywna — czekaj na mastera…',
  night_mafia: 'Głos oddany — czekaj na konsensus…',
  day_vote: 'Głos oddany — czekaj na mastera…',
};

export default function GamePage() {
  const { code } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { emit, on, connected } = useSocket();

  const [phase, setPhase] = useState(null);
  const [round, setRound] = useState(0);
  const [role, setRole] = useState(null);
  const [players, setPlayers] = useState([]);
  const [isMaster, setIsMaster] = useState(false);
  const [nightResult, setNightResult] = useState(undefined);
  const [actionSubmitted, setActionSubmitted] = useState(false);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [submissions, setSubmissions] = useState({});
  const [voteStatus, setVoteStatus] = useState({});
  const [gameOver, setGameOver] = useState(null);
  const [insightFeed, setInsightFeed] = useState([]);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [phaseDeadline, setPhaseDeadline] = useState(null);
  const [detectiveHistory, setDetectiveHistory] = useState([]);
  const [lastDoctorTarget, setLastDoctorTarget] = useState(null);
  const [pendingVerdict, setPendingVerdict] = useState(null);
  const [recentlyEliminatedId, setRecentlyEliminatedId] = useState(null);
  const [showActionOverlay, setShowActionOverlay] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Avoid showing loader on reconnects after first load
  const initialLoadDone = useRef(false);

  // Zawsze aktualny odczyt listy graczy — potrzebny w handlerach socketowych,
  // żeby nie wywoływać setState w środku funkcji-aktualizatora innego setState
  // (co powodowało, że werdykt czasem nie pokazywał się, np. gdy mafia
  // skutecznie kogoś zabiła w nocy).
  const playersRef = useRef(players);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  const loadState = useCallback(async () => {
    const res = await emit('get_game_state', {});
    if (res?.ok) {
      setPhase(res.phase);
      setRound(res.round);
      setRole(res.role);
      setPlayers(res.players || []);
      setIsMaster(res.isMaster || res.players?.some((p) => p.id === user?.id && p.isMaster));
      setPhaseDeadline(res.phaseDeadline ?? null);
      setDetectiveHistory(res.your_action_history?.detective || []);
      setLastDoctorTarget(res.lastDoctorTarget ?? null);
      // Gra już zakończona (np. odświeżenie strony po "Zakończ grę") — pokaż ekran końca gry.
      if (res.status === 'finished') {
        setGameOver({ winner: res.winner ?? null, roles: res.roles });
      }
    }
    initialLoadDone.current = true;
    setStateLoaded(true);
  }, [emit, user?.id]);

  useEffect(() => {
    if (!connected) return;

    // Only show loading screen on first connection, not on reconnects
    if (!initialLoadDone.current) {
      setStateLoaded(false);
    }

    (async () => {
      await emit('join_room', { code });
      await loadState();
    })();

    const offs = [
      on('game_started', (data) => {
        setRole(data.role);
      }),
      on('phase_changed', (data) => {
        setPhase(data.phase);
        setRound(data.round);
        setPhaseDeadline(data.phaseDeadline ?? null);
        setActionSubmitted(false);
        setVoteSubmitted(false);
        setNightResult(undefined);
        setSubmissions({});
        setVoteStatus({});
        setShowActionOverlay(false);
        setPendingVerdict(null);
      }),
      on('night_action_submitted', (data) => {
        setSubmissions((prev) => ({ ...prev, [data.role]: data }));
      }),
      on('vote_submitted', (data) => {
        setVoteStatus((prev) => ({ ...prev, [data.voterId]: new Date() }));
      }),
      on('night_resolved', (data) => {
        if (data.eliminatedPlayerId) {
          const victim = playersRef.current.find((p) => p.id === data.eliminatedPlayerId);
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === data.eliminatedPlayerId ? { ...p, eliminated: true } : p,
            ),
          );
          setRecentlyEliminatedId(data.eliminatedPlayerId);
          setTimeout(() => setRecentlyEliminatedId(null), 3000);
          setPendingVerdict({
            type: 'elimination',
            source: 'night',
            title: 'Rozstrzygnięcie nocy',
            playerName: victim?.username || data.eliminatedPlayerId,
            message: `Tej nocy zginął(a): ${victim?.username || data.eliminatedPlayerId}`,
            autoShow: true,
          });
        } else {
          setPendingVerdict({
            type: 'safe',
            source: 'night',
            title: 'Rozstrzygnięcie nocy',
            message: 'Noc spokojna — nikt nie zginął',
            autoShow: true,
          });
        }
      }),
      on('vote_resolved', (data) => {
        if (data.eliminatedPlayerId) {
          const victim = playersRef.current.find((p) => p.id === data.eliminatedPlayerId);
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === data.eliminatedPlayerId ? { ...p, eliminated: true } : p,
            ),
          );
          setRecentlyEliminatedId(data.eliminatedPlayerId);
          setTimeout(() => setRecentlyEliminatedId(null), 3000);
          setPendingVerdict({
            type: 'elimination',
            source: 'vote',
            playerName: victim?.username || data.eliminatedPlayerId,
            message: `Wioska wyrzuciła: ${victim?.username || data.eliminatedPlayerId}`,
            autoShow: true,
          });
        } else {
          const msg =
            data.outcome === 'tie'
              ? 'Remis — nikt nie odpada'
              : data.outcome === 'vote_skipped'
              ? 'Głosowanie pominięte'
              : 'Brak rozstrzygnięcia';
          setPendingVerdict({
            type: 'safe',
            source: 'vote',
            outcome: data.outcome,
            message: msg,
            autoShow: true,
          });
        }
      }),
      on('game_over', (data) => {
        setGameOver(data);
        setPlayers((prev) =>
          prev.map((p) => ({ ...p, role: data.roles?.[p.id] })),
        );
      }),
      on('player_joined', (data) => {
        setPlayers(data.players);
      }),
      on('master_game_insight', (data) => {
        setInsightFeed((prev) => [...prev, data]);
      }),
      on('night_action_prompt', () => {
        setShowActionOverlay(true);
      }),
    ];

    return () => offs.forEach((off) => off?.());
  }, [connected, code, emit, on, loadState]);

  const ACTION_ERRORS = {
    wrong_phase: 'Zła faza gry — spróbuj ponownie.',
    already_acted: 'Już wykonałeś(aś) akcję w tej turze.',
    eliminated: 'Jesteś wyeliminowany(a).',
    invalid_target: 'Nieprawidłowy cel.',
    target_eliminated: 'Ten gracz jest już wyeliminowany.',
    cannot_self_protect: 'Nie możesz chronić siebie.',
    repeat_protect_forbidden: 'Nie możesz chronić tej samej osoby kolejną noc.',
    master_cannot_act: 'Master nie może wykonywać akcji.',
    no_role: 'Nie masz przypisanej roli.',
    no_action: 'Twoja rola nie ma akcji nocnych.',
    not_connected: 'Brak połączenia — odśwież stronę.',
    timeout: 'Serwer nie odpowiedział. Spróbuj ponownie.',
  };

  async function handleNightAction(targetId) {
    setActionError(null);
    const res = await emit('night_action', { targetId });
    if (res?.ok) {
      setActionSubmitted(true);
      if (res.result) {
        setNightResult(res.result);
        setDetectiveHistory((prev) => [...prev, { targetId, result: res.result }]);
      }
      // Keep overlay open for detective (to show result), close for others
      if (role !== 'detective') {
        setShowActionOverlay(false);
      }
    } else {
      setActionError(ACTION_ERRORS[res?.error] || `Błąd: ${res?.error || 'brak połączenia'}`);
    }
  }

  async function handleVote(targetId) {
    setActionError(null);
    const res = await emit('vote', { targetId });
    if (res?.ok) {
      setVoteSubmitted(true);
      setShowActionOverlay(false);
    } else {
      const msgs = {
        eliminated: 'Jesteś wyeliminowany(a) — nie możesz głosować.',
        already_voted: 'Już oddałeś(aś) głos.',
        wrong_phase: 'To nie jest faza głosowania.',
        master_cannot_vote: 'Master nie głosuje.',
        not_connected: 'Brak połączenia z serwerem.',
        timeout: 'Serwer nie odpowiedział — spróbuj ponownie.',
      };
      setActionError(msgs[res?.error] || `Błąd głosowania: ${res?.error || 'nieznany'}`);
    }
  }

  async function handleAdvancePhase() {
    await emit('advance_phase');
  }

  async function handleEndGame() {
    const res = await emit('end_game', {});
    if (!res?.ok) {
      alert(`Nie udało się zakończyć gry: ${res?.error || 'nieznany błąd'}`);
    }
  }

  const isNightPhaseForRole =
    (role === 'detective' && phase === 'night_detective') ||
    (role === 'doctor' && phase === 'night_doctor') ||
    (role === 'mafia' && phase === 'night_mafia');

  const chatChannel =
    role === 'mafia' && phase === 'night_mafia' ? 'mafia_night' : null;

  const alivePlayers = players.filter(
    (p) => !p.eliminated && p.id !== user?.id && !p.isMaster,
  );

  // Podczas dyskusji i głosowania chowamy rolę i kolor tła, żeby gracze
  // nie mogli odczytać roli z ekranu leżącego na stole telefonu.
  const isPrivacyPhase = phase === 'day_deliberation' || phase === 'day_vote';
  const hideRoleScreen = !isMaster && isPrivacyPhase;

  const bgClass = isMaster
    ? ROLE_BG.master
    : hideRoleScreen
    ? 'bg-night'
    : ROLE_BG[role] || 'bg-night';
  const roleColorClass = ROLE_COLORS[role] || 'text-white';
  const roleLabel = isMaster ? 'Master' : ROLE_LABELS[role] || role;
  const roundTitleLabel = phase === 'day_vote' ? 'Głosowanie' : 'Dyskusja';

  const me = players.find((p) => p.id === user?.id);
  const isEliminated = Boolean(me?.eliminated);

  const needsAction =
    !isMaster &&
    !isEliminated &&
    ((isNightPhaseForRole && !actionSubmitted) ||
      (phase === 'day_vote' && !voteSubmitted));

  const actionDone =
    !isMaster &&
    !isEliminated &&
    ((isNightPhaseForRole && actionSubmitted) ||
      (phase === 'day_vote' && voteSubmitted));

  const waitingLabel = actionDone
    ? (ACTION_WAITING[phase] || 'Czekaj na mastera…')
    : null;

  useEffect(() => {
    if (needsAction) setShowActionOverlay(true);
  }, [needsAction, phase]);

  // Wyeliminowany gracz nie powinien widzieć kokpitu akcji/głosowania.
  useEffect(() => {
    if (isEliminated) setShowActionOverlay(false);
  }, [isEliminated]);

  if (!stateLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center bg-night">
        <p className="text-white/40 text-sm animate-pulse">Ładowanie stanu gry…</p>
      </div>
    );
  }

  if (gameOver) {
    const mafiaWon = gameOver.winner === 'mafia';
    const townWon = gameOver.winner === 'town';
    const endedByMaster = !mafiaWon && !townWon;
    const bgClassOver = mafiaWon
      ? 'bg-role-mafia'
      : townWon
      ? 'bg-role-detective'
      : 'bg-night';
    const titleClassOver = mafiaWon
      ? 'text-role-mafia'
      : townWon
      ? 'text-role-detective'
      : 'text-white';
    const titleTextOver = mafiaWon
      ? 'Mafia wygrywa!'
      : townWon
      ? 'Miasto wygrywa!'
      : 'Gra zakończona';

    return (
      <div
        className={`h-dvh flex flex-col items-center px-6 gap-5 overflow-y-auto py-10 ${bgClassOver}`}
      >
        {/* Spacer to keep content vertically centered when it fits, without cutting off the top when it doesn't */}
        <div className="flex-1 min-h-0" />

        {/* Winner banner */}
        <div className="text-center animate-reveal-in shrink-0">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40 mb-2">Koniec gry</p>
          <h1 className={`font-display text-5xl font-bold ${titleClassOver}`}>
            {titleTextOver}
          </h1>
          <p className="text-white/40 text-sm mt-2">
            {endedByMaster
              ? `Master zakończył rozgrywkę w rundzie ${round} · wszystkie role ujawnione`
              : `Runda ${round} · wszystkie role ujawnione`}
          </p>
        </div>

        {/* Player list with roles */}
        <div className="w-full max-w-md shrink-0">
          <PlayerList players={players} showRoles gridLayout />
        </div>

        {/* Navigation buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full max-w-xs animate-reveal-in shrink-0">
          {isMaster && (
            <button
              type="button"
              onClick={() => router.push(`/room/${code}`)}
              className="btn-primary flex-1 text-center"
            >
              Wróć do pokoju
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push('/lobby')}
            className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-white/70 hover:text-white hover:border-white/40 text-sm font-semibold transition-colors text-center"
          >
            Strona główna
          </button>
        </div>

        <div className="flex-1 min-h-0" />
      </div>
    );
  }

  return (
    <div className={`h-dvh overflow-hidden flex flex-col ${bgClass}`}>
      {/* Top — logo M + leave button */}
      <header className="shrink-0 flex items-center justify-between px-4 pt-4 pb-1">
        <button
          type="button"
          onClick={() => setShowLeaveConfirm(true)}
          className="text-white/30 hover:text-white/70 transition-colors text-xs font-medium flex items-center gap-1"
          aria-label="Wyjdź z gry"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Wyjdź
        </button>

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="group relative p-2 rounded-xl transition-transform active:scale-95 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          aria-label="Menu gry"
        >
          <div className="absolute inset-0 rounded-xl bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <img
            src="/logo.png"
            alt="Sieje Hot Crew"
            className="w-10 h-10 object-contain select-none"
            draggable={false}
          />
        </button>

        {/* Spacer to keep logo centered */}
        <div className="w-[56px]" />
      </header>

      {/* Center */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {isMaster ? (
          /* ── Master: two-column layout ── */
          <div className="h-full grid grid-cols-2 gap-3 p-3 overflow-hidden">
            {/* Left: controls + insight feed */}
            <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
              <div className="shrink-0">
                <MasterControls
                  phase={phase}
                  submissions={submissions}
                  voteStatus={voteStatus}
                  players={players}
                  onAdvance={handleAdvancePhase}
                  onEndGame={handleEndGame}
                />
              </div>
              {/* Insight feed grows to fill remaining space */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <MasterInsightFeed entries={insightFeed} players={players} />
              </div>
            </div>

            {/* Right: player list with roles */}
            <div className="flex flex-col gap-2 min-h-0 overflow-hidden">
              <div className="flex items-center gap-2 shrink-0">
                <h3 className="font-display text-sm font-bold text-white/50 uppercase tracking-wider">
                  Gracze
                </h3>
                <span className="text-[12px] text-white/30">
                  {players.filter((p) => !p.eliminated).length} żywych / {players.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <PlayerList players={players} showRoles gridLayout />
              </div>
            </div>
          </div>
        ) : (
          /* ── Player: role center + status ── */
          <div className="h-full flex flex-col items-center justify-center px-6 gap-4">
            {hideRoleScreen ? (
              <>
                <p className="text-white/40 text-xs uppercase tracking-[0.25em]">Runda {round}</p>
                <h1 className="font-display text-5xl sm:text-6xl font-bold capitalize text-white">
                  {roundTitleLabel}
                </h1>
              </>
            ) : (
              <>
                <p className="text-white/40 text-xs uppercase tracking-[0.25em]">Twoja rola</p>
                <h1
                  className={`font-display text-5xl sm:text-6xl font-bold capitalize ${roleColorClass}`}
                >
                  {roleLabel}
                </h1>
              </>
            )}

            {/* Wyeliminowany gracz — komunikat zamiast kokpitu akcji */}
            {isEliminated && (
              <div className="flex flex-col items-center gap-2 mt-2">
                <span className="text-3xl">💀</span>
                <p className="text-white/60 text-sm font-semibold">Zostałeś(aś) wyeliminowany(a)</p>
                <p className="text-white/35 text-xs text-center max-w-xs">
                  Możesz obserwować dalszy przebieg gry, ale nie bierzesz już w niej udziału.
                </p>
              </div>
            )}

            {/* Waiting loader after action */}
            {!isEliminated && actionDone && waitingLabel && (
              <div className="flex flex-col items-center gap-3 mt-2">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-2 h-2 rounded-full bg-white/40 animate-pulse"
                      style={{ animationDelay: `${i * 0.2}s` }}
                    />
                  ))}
                </div>
                <p className="text-white/50 text-sm text-center">{waitingLabel}</p>
                {/* Detective result if available */}
                {role === 'detective' && nightResult !== undefined && (
                  <div
                    className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                      nightResult?.is_mafia
                        ? 'bg-red-900/30 text-role-mafia'
                        : 'bg-green-900/30 text-role-detective'
                    }`}
                  >
                    {nightResult?.is_mafia ? 'To jest Mafia!' : 'To nie jest Mafia.'}
                  </div>
                )}
              </div>
            )}

            {/* Action button when player hasn't acted yet */}
            {!isEliminated && needsAction && !showActionOverlay && (
              <button
                type="button"
                onClick={() => setShowActionOverlay(true)}
                className="btn-primary mt-4"
              >
                {isNightPhaseForRole ? 'Wykonaj akcję' : 'Głosuj'}
              </button>
            )}
          </div>
        )}
      </main>

      {/* Bottom — turn info bar (always visible) */}
      <footer className="shrink-0 border-t border-white/10 bg-black/40 backdrop-blur-md px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <PhaseBadge phase={phase} round={round} compact />
            <p className="text-white/45 text-xs mt-1 truncate italic">
              {PHASE_FLAVOR[phase] ?? PHASE_FLAVOR.null}
            </p>
          </div>
          <TurnTimer phaseDeadline={phaseDeadline} phase={phase} />
        </div>
      </footer>

      {/* Mafia chat */}
      {chatChannel && (
        <div className="shrink-0 h-44 border-t border-white/10 bg-black/30">
          <Chat channel={chatChannel} roomCode={code} />
        </div>
      )}

      {/* Action overlay */}
      {showActionOverlay && !isMaster && !isEliminated && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowActionOverlay(false); setActionError(null); }}
            aria-label="Zamknij"
          />
          <div className="relative w-full max-w-lg mx-4 mb-4 sm:mb-0 max-h-[85dvh] overflow-y-auto animate-popup-in space-y-2 flex flex-col">
            {/* Error banner */}
            {actionError && (
              <div className="card bg-red-900/40 border border-red-500/30 text-red-200 text-sm py-2 px-3">
                ⚠ {actionError}
              </div>
            )}
            {isNightPhaseForRole && (
              <NightActionPicker
                role={role}
                players={alivePlayers}
                onSubmit={handleNightAction}
                disabled={actionSubmitted}
                result={nightResult}
                lastDoctorTarget={lastDoctorTarget}
              />
            )}
            {phase === 'day_vote' && (
              <VotePanel
                players={alivePlayers}
                onVote={handleVote}
                disabled={voteSubmitted}
              />
            )}
          </div>
        </div>
      )}

      {/* Verdict — master ma już te informacje w panelu insightów, nie blokujemy mu widoku popupem */}
      {pendingVerdict && !isMaster && (
        <VerdictReveal
          verdict={pendingVerdict}
          autoShow={pendingVerdict.autoShow}
          onDismiss={() => setPendingVerdict(null)}
        />
      )}

      <GameMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        players={players}
        role={role}
        roomCode={code}
        isMaster={isMaster}
        detectiveHistory={detectiveHistory}
        lastDoctorTarget={lastDoctorTarget}
        recentlyEliminatedId={recentlyEliminatedId}
      />

      {/* Leave game confirmation */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowLeaveConfirm(false)}
            aria-label="Anuluj"
          />
          <div className="relative card max-w-xs w-full space-y-4 animate-popup-in text-center">
            <h3 className="font-display text-lg font-bold">Opuścić grę?</h3>
            <p className="text-white/50 text-sm">
              {isMaster
                ? 'Jako master możesz wrócić do pokoju i ponownie uruchomić grę, lub wyjść do lobby.'
                : 'Twoja rola zostanie ujawniona masterowi. Możesz dołączyć ponownie tym samym kodem.'}
            </p>
            <div className="flex flex-col gap-2">
              {isMaster && (
                <button
                  type="button"
                  onClick={() => router.push(`/room/${code}`)}
                  className="btn-primary w-full"
                >
                  Wróć do pokoju
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push('/lobby')}
                className="w-full px-4 py-2 rounded-lg border border-white/20 text-white/70 hover:text-white hover:border-white/40 text-sm font-semibold transition-colors"
              >
                Wyjdź do lobby
              </button>
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="text-white/30 hover:text-white/60 text-sm py-1 transition-colors"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
