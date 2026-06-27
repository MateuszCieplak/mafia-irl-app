'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
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

export default function GamePage() {
  const { code } = useParams();
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
  const [phaseKey, setPhaseKey] = useState(0);
  const [pendingVerdict, setPendingVerdict] = useState(null);
  const [recentlyEliminatedId, setRecentlyEliminatedId] = useState(null);
  const [showActionOverlay, setShowActionOverlay] = useState(false);

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
    setStateLoaded(true);
  }, [emit, user?.id]);

  useEffect(() => {
    if (!connected) return;

    setStateLoaded(false);
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
        setPhaseKey((k) => k + 1);
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
    return (
      <div className="h-dvh flex flex-col items-center justify-center px-6 gap-6 bg-night">
        <h1 className="font-display text-4xl font-bold animate-reveal-in">
          {gameOver.winner === 'mafia' ? 'Mafia wygrywa!' : 'Miasto wygrywa!'}
        </h1>
        <p className="text-white/50">Wszystkie role ujawnione</p>
        <PlayerList players={players} showRoles gridLayout />
      </div>
    );
  }

  return (
    <div className={`h-dvh overflow-hidden flex flex-col ${bgClass}`}>
      {/* Top — logo M */}
      <header className="shrink-0 flex justify-center pt-6 pb-2">
        <MafiaLogo onClick={() => setMenuOpen(true)} />
      </header>

      {/* Center — role or master panel hint */}
      <main
        key={phaseKey}
        className="flex-1 flex flex-col items-center justify-center px-6 animate-phase-fade min-h-0"
      >
        {isMaster ? (
          <div className="w-full max-w-md space-y-3 overflow-y-auto max-h-full py-2">
            <MasterControls
              phase={phase}
              submissions={submissions}
              onAdvance={handleAdvancePhase}
              onEndGame={handleEndGame}
            />
            <MasterInsightFeed entries={insightFeed} players={players} />
            <div className="card">
              <h3 className="font-display text-sm font-bold text-white/50 mb-2 uppercase tracking-wider">
                Gracze
              </h3>
              <PlayerList players={players} showRoles gridLayout />
            </div>
          </div>
        ) : (
          <>
            <p className="text-white/40 text-xs uppercase tracking-[0.25em] mb-2">Twoja rola</p>
            <h1
              className={`font-display text-5xl sm:text-6xl font-bold capitalize animate-role-reveal ${roleColorClass}`}
            >
              {roleLabel}
            </h1>
            {needsAction && !showActionOverlay && (
              <button
                type="button"
                onClick={() => setShowActionOverlay(true)}
                className="btn-primary mt-6 animate-phase-fade"
              >
                {isNightPhaseForRole ? 'Wykonaj akcję' : 'Głosuj'}
              </button>
            )}
          </>
        )}
      </main>

      {/* Bottom — turn info bar */}
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

      {/* Mafia chat — only during mafia night */}
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
