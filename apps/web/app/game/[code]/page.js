'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';
import MafiaLogo from '@/components/MafiaLogo';
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

  // Avoid showing loader on reconnects after first load
  const initialLoadDone = useRef(false);

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
        setShowActionOverlay(false);
        setPendingVerdict(null);
      }),
      on('night_action_submitted', (data) => {
        setSubmissions((prev) => ({ ...prev, [data.role]: data.submitted }));
      }),
      on('night_resolved', (data) => {
        if (data.eliminatedPlayerId) {
          setPlayers((prev) => {
            const updated = prev.map((p) =>
              p.id === data.eliminatedPlayerId ? { ...p, eliminated: true } : p,
            );
            const victim = updated.find((p) => p.id === data.eliminatedPlayerId);
            setRecentlyEliminatedId(data.eliminatedPlayerId);
            setTimeout(() => setRecentlyEliminatedId(null), 3000);
            setPendingVerdict({
              type: 'elimination',
              source: 'night',
              playerName: victim?.username || data.eliminatedPlayerId,
              message: `Tej nocy zginął(a): ${victim?.username || data.eliminatedPlayerId}`,
            });
            return updated;
          });
        } else {
          setPendingVerdict({
            type: 'safe',
            source: 'night',
            message: 'Noc spokojna — nikt nie zginął',
          });
        }
      }),
      on('vote_resolved', (data) => {
        if (data.eliminatedPlayerId) {
          setPlayers((prev) => {
            const updated = prev.map((p) =>
              p.id === data.eliminatedPlayerId ? { ...p, eliminated: true } : p,
            );
            const victim = updated.find((p) => p.id === data.eliminatedPlayerId);
            setRecentlyEliminatedId(data.eliminatedPlayerId);
            setTimeout(() => setRecentlyEliminatedId(null), 3000);
            setPendingVerdict({
              type: 'elimination',
              source: 'vote',
              playerName: victim?.username || data.eliminatedPlayerId,
              message: `Wioska wyrzuciła: ${victim?.username || data.eliminatedPlayerId}`,
              autoShow: true,
            });
            return updated;
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

  async function handleNightAction(targetId) {
    const res = await emit('night_action', { targetId });
    if (res?.ok) {
      setActionSubmitted(true);
      if (res.result) {
        setNightResult(res.result);
        setDetectiveHistory((prev) => [...prev, { targetId, result: res.result }]);
      }
      setShowActionOverlay(false);
    }
  }

  async function handleVote(targetId) {
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
      alert(msgs[res.error] || `Błąd głosowania: ${res.error || 'nieznany'}`);
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

  const bgClass = isMaster ? ROLE_BG.master : ROLE_BG[role] || 'bg-night';
  const roleColorClass = ROLE_COLORS[role] || 'text-white';
  const roleLabel = isMaster ? 'Master' : ROLE_LABELS[role] || role;

  const needsAction =
    !isMaster &&
    ((isNightPhaseForRole && !actionSubmitted) ||
      (phase === 'day_vote' && !voteSubmitted));

  const actionDone =
    !isMaster &&
    ((isNightPhaseForRole && actionSubmitted) ||
      (phase === 'day_vote' && voteSubmitted));

  const waitingLabel = actionDone
    ? (ACTION_WAITING[phase] || 'Czekaj na mastera…')
    : null;

  useEffect(() => {
    if (needsAction) setShowActionOverlay(true);
  }, [needsAction, phase]);

  if (!stateLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center bg-night">
        <p className="text-white/40 text-sm animate-pulse">Ładowanie stanu gry…</p>
      </div>
    );
  }

  if (gameOver) {
    const mafiaWon = gameOver.winner === 'mafia';
    return (
      <div
        className={`h-dvh flex flex-col items-center justify-center px-6 gap-5 overflow-y-auto py-10 ${
          mafiaWon ? 'bg-role-mafia' : 'bg-role-detective'
        }`}
      >
        {/* Winner banner */}
        <div className="text-center animate-reveal-in">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40 mb-2">Koniec gry</p>
          <h1
            className={`font-display text-5xl font-bold ${
              mafiaWon ? 'text-role-mafia' : 'text-role-detective'
            }`}
          >
            {mafiaWon ? 'Mafia wygrywa!' : 'Miasto wygrywa!'}
          </h1>
          <p className="text-white/40 text-sm mt-2">
            Runda {round} · wszystkie role ujawnione
          </p>
        </div>

        {/* Player list with roles */}
        <div className="w-full max-w-md">
          <PlayerList players={players} showRoles gridLayout />
        </div>

        {/* Navigation buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full max-w-xs animate-reveal-in">
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
      </div>
    );
  }

  return (
    <div className={`h-dvh overflow-hidden flex flex-col ${bgClass}`}>
      {/* Top — logo M */}
      <header className="shrink-0 flex justify-center pt-5 pb-1">
        <MafiaLogo onClick={() => setMenuOpen(true)} />
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
                <span className="text-[10px] text-white/30">
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
            <p className="text-white/40 text-xs uppercase tracking-[0.25em]">Twoja rola</p>
            <h1
              className={`font-display text-5xl sm:text-6xl font-bold capitalize ${roleColorClass}`}
            >
              {roleLabel}
            </h1>

            {/* Waiting loader after action */}
            {actionDone && waitingLabel && (
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
            {needsAction && !showActionOverlay && (
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
      {showActionOverlay && !isMaster && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowActionOverlay(false)}
            aria-label="Zamknij"
          />
          <div className="relative w-full max-w-lg mx-4 mb-4 sm:mb-0 max-h-[70dvh] overflow-y-auto animate-popup-in">
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

      {/* Verdict */}
      {pendingVerdict && (
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
    </div>
  );
}
