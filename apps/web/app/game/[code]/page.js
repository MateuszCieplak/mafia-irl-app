'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';
import PlayerList from '@/components/PlayerList';
import PhaseBadge from '@/components/PhaseBadge';
import NightActionPicker from '@/components/NightActionPicker';
import VotePanel from '@/components/VotePanel';
import MasterControls from '@/components/MasterControls';
import MasterInsightFeed from '@/components/MasterInsightFeed';
import Chat from '@/components/Chat';
import Notepad from '@/components/Notepad';
import PlayerPhaseInfo from '@/components/PlayerPhaseInfo';

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
  const [showRole, setShowRole] = useState(true);
  const [insightFeed, setInsightFeed] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [stateLoaded, setStateLoaded] = useState(false);

  useEffect(() => {
    if (!connected) return;

    setStateLoaded(false);
    // Najpierw join_room (ustawia socket.roomId na serwerze), potem get_game_state.
    // Bez tego łańcucha get_game_state często leci szybciej i zwraca no_room.
    (async () => {
      await emit('join_room', { code });
      const res = await emit('get_game_state', {});
      if (res?.ok) {
        setPhase(res.phase);
        setRound(res.round);
        setRole(res.role);
        setPlayers(res.players || []);
        setIsMaster(res.players?.some((p) => p.id === user?.id && p.isMaster));
      }
      setStateLoaded(true);
    })();

    const offs = [
      on('game_started', (data) => {
        setRole(data.role);
        setShowRole(true);
        setTimeout(() => setShowRole(false), 5000);
      }),
      on('phase_changed', (data) => {
        setPhase(data.phase);
        setRound(data.round);
        setActionSubmitted(false);
        setVoteSubmitted(false);
        setNightResult(undefined);
        setSubmissions({});
        setLastResult(null);
      }),
      on('night_action_submitted', (data) => {
        setSubmissions((prev) => ({ ...prev, [data.role]: data.submitted }));
      }),
      on('night_resolved', (data) => {
        if (data.eliminatedPlayerId) {
          setPlayers((prev) => {
            const updated = prev.map((p) =>
              p.id === data.eliminatedPlayerId ? { ...p, eliminated: true } : p
            );
            const victim = updated.find((p) => p.id === data.eliminatedPlayerId);
            setLastResult({
              type: 'elimination',
              message: `Tej nocy zginął(a): ${victim?.username || data.eliminatedPlayerId}`,
            });
            return updated;
          });
        } else {
          setLastResult({ type: 'safe', message: 'Noc spokojna — nikt nie zginął' });
        }
      }),
      on('vote_resolved', (data) => {
        if (data.eliminatedPlayerId) {
          setPlayers((prev) => {
            const updated = prev.map((p) =>
              p.id === data.eliminatedPlayerId ? { ...p, eliminated: true } : p
            );
            const victim = updated.find((p) => p.id === data.eliminatedPlayerId);
            setLastResult({
              type: 'elimination',
              message: `Wioska wyrzuciła: ${victim?.username || data.eliminatedPlayerId}`,
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
          setLastResult({ type: 'safe', message: msg });
        }
      }),
      on('game_over', (data) => {
        setGameOver(data);
        setPlayers((prev) =>
          prev.map((p) => ({ ...p, role: data.roles?.[p.id] }))
        );
      }),
      on('player_joined', (data) => {
        setPlayers(data.players);
      }),
      on('master_game_insight', (data) => {
        setInsightFeed((prev) => [...prev, data]);
      }),
    ];

    return () => offs.forEach((off) => off?.());
  }, [connected, code]);

  async function handleNightAction(targetId) {
    const res = await emit('night_action', { targetId });
    if (res?.ok) {
      setActionSubmitted(true);
      if (res.result) setNightResult(res.result);
    }
  }

  async function handleVote(targetId) {
    const res = await emit('vote', { targetId });
    if (res?.ok) {
      setVoteSubmitted(true);
    } else {
      const msgs = {
        eliminated: 'Jesteś wyeliminowany(a) — nie możesz głosować.',
        already_voted: 'Już oddałeś(aś) głos.',
        wrong_phase: 'To nie jest faza głosowania.',
        master_cannot_vote: 'Master nie głosuje.',
        not_connected: 'Brak połączenia z serwerem.',
        timeout: 'Serwer nie odpowiedział — spróbuj ponownie.',
      };
      const msg = msgs[res.error] || `Błąd głosowania: ${res.error || 'nieznany'}`;
      alert(msg);
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
    phase?.startsWith('day') ? 'day' :
    (role === 'mafia' && phase === 'night_mafia') ? 'mafia_night' :
    null;

  // Master nie bierze udziału w głosowaniu ani nocnych akcjach — filtrujemy go z listy celów.
  const alivePlayers = players.filter(
    (p) => !p.eliminated && p.id !== user?.id && !p.isMaster,
  );

  if (!stateLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-white/40 text-sm animate-pulse">Ładowanie stanu gry…</p>
      </div>
    );
  }

  if (gameOver) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
        <h1 className="font-display text-4xl font-bold">
          {gameOver.winner === 'mafia' ? 'Mafia wygrywa!' : 'Miasto wygrywa!'}
        </h1>
        <p className="text-white/50">Wszystkie role ujawnione</p>
        <PlayerList players={players} showRoles />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <PhaseBadge phase={phase} round={round} />
        <Notepad roomCode={code} />
      </div>

      {/* Role reveal */}
      {showRole && role && (
        <div className="mx-4 mt-3">
          <div className={`card text-center py-6 ${role === 'mafia' ? 'border-blood/30' : 'border-town/30'}`}>
            <p className="text-white/50 text-xs mb-1">Twoja rola</p>
            <p className="font-display text-2xl font-bold capitalize">{role}</p>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Master controls */}
        {isMaster && (
          <>
            <MasterControls
              phase={phase}
              submissions={submissions}
              onAdvance={handleAdvancePhase}
              onEndGame={handleEndGame}
            />
            <MasterInsightFeed entries={insightFeed} players={players} />
          </>
        )}

        {/* Statusy fazowe i wyniki dla graczy (nie mastera) */}
        {!isMaster && (
          <PlayerPhaseInfo phase={phase} lastResult={lastResult} />
        )}

        {/* Night action */}
        {isNightPhaseForRole && (
          <NightActionPicker
            role={role}
            players={alivePlayers}
            onSubmit={handleNightAction}
            disabled={actionSubmitted}
            result={nightResult}
          />
        )}

        {/* Day voting — master tylko obserwuje */}
        {phase === 'day_vote' && !isMaster && (
          <VotePanel
            players={alivePlayers}
            onVote={handleVote}
            disabled={voteSubmitted}
          />
        )}

        {/* Player list */}
        <div className="card">
          <h3 className="font-display text-sm font-bold text-white/50 mb-2 uppercase tracking-wider">
            Gracze
          </h3>
          <PlayerList players={players} gridLayout />
        </div>
      </div>

      {/* Chat */}
      {chatChannel && (
        <div className="h-60 border-t border-white/10">
          <Chat channel={chatChannel} roomCode={code} />
        </div>
      )}
    </div>
  );
}
