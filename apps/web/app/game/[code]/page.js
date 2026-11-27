'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useSocket } from '@/lib/useSocket';
import GameMenu from '@/components/GameMenu';
import TurnTimer from '@/components/TurnTimer';
import PhaseBadge from '@/components/PhaseBadge';
import NightActionPicker, { MafiaVotesSummary } from '@/components/NightActionPicker';
import VotePanel from '@/components/VotePanel';
import MasterControls from '@/components/MasterControls';
import MasterInsightFeed from '@/components/MasterInsightFeed';
import MafiaChatDrawer from '@/components/MafiaChatDrawer';
import RoleCornerMenu from '@/components/RoleCornerMenu';
import { resolveAvatarUrl } from '@/lib/avatar';
import AnimatedModal from '@/components/AnimatedModal';
import GameOverScreen from '@/components/GameOverScreen';
import PhaseResultScreen from '@/components/PhaseResultScreen';
import PlayerList from '@/components/PlayerList';
import CardUseModal from '@/components/CardUseModal';
import CardNightPicker from '@/components/CardNightPicker';
import { CARD_PHASES, CARD_INFO } from '@/lib/cards';
import { ROLE_LABELS, ROLE_COLORS, ROLE_BG } from '@/lib/roleTheme';
import { useTransient } from '@/lib/useTransient';

const PHASE_FLAVOR = {
  null: 'Zapada noc…',
  role_reveal: 'Zapoznaj się ze swoją rolą, a potem zgaś ekran telefonu.',
  night_mafia_card: 'Budzi się mafia…',
  night_citizen_card: 'Budzi się obywatel i wykorzystuje swoją kartę mocy.',
  night_detective: 'Detektyw sprawdza podejrzanego…',
  night_doctor: 'Lekarz chroni wybraną osobę…',
  night_mafia: 'Mafia naradza się w cieniu…',
  night_resolve: 'Noc dobiega końca…',
  day_deliberation: 'Czas na dyskusję',
  day_vote: 'Czas głosowania',
  day_resolve: 'Rozstrzygnięcie głosowania…',
};

const ACTION_WAITING = {
  night_mafia_card: 'Karta użyta — czekaj na mastera…',
  night_citizen_card: 'Karta użyta — czekaj na mastera…',
  night_detective: 'Informacja przekazana masterowi…',
  night_doctor: 'Ochrona aktywna — czekaj na mastera…',
  night_mafia: 'Głos oddany — czekaj na konsensus…',
  day_vote: 'Głos oddany — czekaj na mastera…',
};

/**
 * Łączy wpisy podglądu live z serwera i z eventów bez dubli (po `seq`) i w kolejności
 * gry — event może przyjść w trakcie pobierania historii po odświeżeniu strony.
 */
function withAvatars(list) {
  return list.map((p) => ({ ...p, avatarUrl: resolveAvatarUrl(p.avatarUrl) }));
}

function mergeInsights(a, b) {
  const bySeq = new Map();
  for (const e of [...(a || []), ...(b || [])]) {
    bySeq.set(e.seq ?? `${e.timestamp}:${e.kind}`, e);
  }
  return Array.from(bySeq.values()).sort(
    (x, y) => (x.seq ?? 0) - (y.seq ?? 0) || (x.timestamp ?? 0) - (y.timestamp ?? 0),
  );
}

export default function GamePage() {
  const { code } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { emit, on, connected, reconnect, isConnected } = useSocket();

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
  // Na kogo oddałem głos w głosowaniu dziennym (null = pominięcie / brak głosu).
  const [myVoteTarget, setMyVoteTarget] = useState(null);
  const [gameOver, setGameOver] = useState(null);
  // Master wrócił z ekranu końca gry do pokoju (pokój znów jest w lobby).
  const [masterInLobby, setMasterInLobby] = useState(false);
  const gameOverRef = useRef(null);
  gameOverRef.current = gameOver;
  const [insightFeed, setInsightFeed] = useState([]);
  // Mafia wybrała różne cele — { votes: { mafiosoId: targetId } } albo null.
  const [mafiaDisagreement, setMafiaDisagreement] = useState(null);
  // Aktualne głosy żywych mafiosów { mafiosoId: targetId } (tylko dla mafii w nocy).
  const [mafiaVotes, setMafiaVotes] = useState({});
  // Głosowanie dzienne: na kogo głosują współmafiosi (widzi tylko mafia).
  const [mafiaDayVotes, setMafiaDayVotes] = useState({});
  // Id współmafiosów, którzy odpadli z gry (widzi tylko mafia).
  const [mafiaFallen, setMafiaFallen] = useState([]);
  // Id współmafiosów, jeśli serwer je poda (opcjonalnie) — do „jeszcze nie zagłosował”.
  const [mafiaTeammateIds, setMafiaTeammateIds] = useState(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  // Po powrocie z tła nie pokazujemy starego ekranu roli — neutralny ekran
  // „Synchronizuję…” do pierwszego udanego get_game_state (twardy limit ~4 s).
  const [syncing, setSyncing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [phaseDeadline, setPhaseDeadline] = useState(null);
  const [detectiveHistory, setDetectiveHistory] = useState([]);
  const [doctorHistory, setDoctorHistory] = useState([]);
  // Wielu lekarzy/detektywów: bieżąca tura w fazie, moja tura i liczba tur (master).
  const [turn, setTurn] = useState(0);
  const [turnCount, setTurnCount] = useState(1);
  const [myTurnIndex, setMyTurnIndex] = useState(null);
  const [lastDoctorTarget, setLastDoctorTarget] = useState(null);
  const [roomSettings, setRoomSettings] = useState(null);
  const [phaseResult, setPhaseResult] = useState(null);
  const [recentlyEliminatedId, setRecentlyEliminatedId] = useState(null);
  const [showActionOverlay, setShowActionOverlay] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  // Werdykt nocy przetrwuje wejście w dyskusję (phase_changed czyści phaseResult),
  // żeby pokazać go jako nakładkę na starcie fazy dyskusji — zamykaną „Zatwierdź”.
  const [nightVerdict, setNightVerdict] = useState(null);
  const [showNightVerdict, setShowNightVerdict] = useState(false);
  // Tryb zaawansowany — karty mocy (własne karty, dziennik wyników, tura nocna).
  const [cards, setCards] = useState([]);
  const [cardLog, setCardLog] = useState([]);
  const [cardPrompt, setCardPrompt] = useState(null);
  const [cardNightResult, setCardNightResult] = useState(null);
  const [mafiaCard, setMafiaCard] = useState(null);
  const [cardQueue, setCardQueue] = useState(null);
  const [cardsOverview, setCardsOverview] = useState(null);
  const [nextPhase, setNextPhase] = useState(null);
  const [showCardModal, setShowCardModal] = useState(false);

  // Podgląd roli tylko na czas przytrzymania; znika przy każdym wygaszeniu ekranu.
  const [peekRole, setPeekRole] = useState(false);
  useEffect(() => {
    const hide = () => setPeekRole(false);
    const onVis = () => document.visibilityState === 'hidden' && hide();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', hide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', hide);
    };
  }, []);

  // Puszczenie palca/myszy gdziekolwiek kończy podgląd (przycisk może zniknąć lub palec zjechać).
  useEffect(() => {
    if (!peekRole) return;
    const hide = () => setPeekRole(false);
    window.addEventListener('pointerup', hide);
    window.addEventListener('pointercancel', hide);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('pointerup', hide);
      window.removeEventListener('pointercancel', hide);
      window.removeEventListener('blur', hide);
    };
  }, [peekRole]);

  // Zmiana fazy też kasuje podgląd, żeby rola nie została odsłonięta w nowej fazie.
  useEffect(() => {
    setPeekRole(false);
  }, [phase]);

  const isMasterRef = useRef(false);
  isMasterRef.current = isMaster;

  // Neutralny ekran „Synchronizuję…” jest już na wierzchu → można zdjąć zasłonę
  // postawioną przy wygaszeniu ekranu (patrz efekt z visibilitychange).
  useEffect(() => {
    if (syncing) delete document.documentElement.dataset.privacyCover;
  }, [syncing]);

  const handleReturnToRoom = useCallback(() => {
    // Reset pokoju leci w tle — serwer czyści role/eliminacje gracz po graczu,
    // więc czekanie na ack dawało wyraźne opóźnienie po kliknięciu. Socket jest
    // wspólny dla całej aplikacji, więc żądanie dokończy się mimo nawigacji,
    // a pokój zsynchronizuje się eventem `room_reset_to_lobby`.
    if (isMaster) {
      emit('return_to_room', {});
    }
    router.push(`/room/${code}`);
  }, [isMaster, emit, router, code]);

  const handleGoHome = useCallback(() => {
    // Gracz świadomie wychodzi: w lobby (po powrocie mastera) zwalnia miejsce,
    // po grze pozostaje uczestnikiem (baner „wróć” na stronie głównej).
    if (!isMaster && masterInLobby) emit('leave_room', { code });
    router.push('/lobby');
  }, [isMaster, masterInLobby, emit, router, code]);

  // Avoid showing loader on reconnects after first load
  const initialLoadDone = useRef(false);

  const loadState = useCallback(async (opts) => {
    const res = await emit('get_game_state', {}, opts);
    if (res?.ok) {
      setPhase(res.phase);
      setRound(res.round);
      setRole(res.role);
      setPlayers(withAvatars(res.players || []));
      setIsMaster(res.isMaster || res.players?.some((p) => p.id === user?.id && p.isMaster));
      setPhaseDeadline(res.phaseDeadline ?? null);
      // Wynik rozstrzygnięcia przychodzi ze stanu, nie tylko z eventu — dzięki
      // temu ekran werdyktu odtwarza się po obudzeniu telefonu / odświeżeniu.
      setPhaseResult(res.phaseResult ?? null);
      // Werdykt nocy ze stanu (nie kasowany w dyskusji) — dzięki temu nakładka
      // z wynikiem nocy odtwarza się po odświeżeniu strony w fazie dyskusji.
      setNightVerdict(res.lastNightResult ?? null);
      setDetectiveHistory(res.your_action_history?.detective || []);
      setDoctorHistory(res.your_action_history?.doctor || []);
      setTurn(res.turn ?? 0);
      setTurnCount(res.turnCount ?? 1);
      setMyTurnIndex(res.myTurnIndex ?? null);
      setLastDoctorTarget(res.lastDoctorTarget ?? null);
      setRoomSettings(res.settings ?? null);
      setNextPhase(res.nextPhase ?? null);
      setCards(res.cards ?? []);
      setCardLog(res.cardLog ?? []);
      setCardPrompt(res.cardPrompt ?? null);
      setMafiaCard(res.mafiaCard ?? null);
      setCardQueue(res.cardQueue ?? null);
      setCardsOverview(res.cardsOverview ?? null);
      // Stan „akcja/głos złożony” bierzemy z serwera — po wygaszeniu ekranu
      // `phase_changed` mogło przepaść i lokalna flaga z poprzedniej nocy
      // blokowałaby wybór celu w nowej.
      setActionSubmitted(Boolean(res.nightActionSubmitted));
      setVoteSubmitted(Boolean(res.voteSubmitted));
      setMyVoteTarget(res.myVoteTarget ?? null);
      // Master: kto już zagłosował — bez tego po odświeżeniu wszystkie karty wracały do „głosuje…”.
      if (Array.isArray(res.votedPlayerIds)) {
        const now = new Date();
        setVoteStatus(Object.fromEntries(res.votedPlayerIds.map((id) => [id, now])));
      }
      setMafiaDisagreement(res.mafiaDisagreement ? { votes: res.mafiaVotes || {} } : null);
      setMafiaVotes(res.mafiaVotes || {});
      setMafiaDayVotes(res.mafiaDayVotes || {});
      setMafiaFallen(res.mafiaFallen || []);
      const mates = res.mafiaTeammates ?? res.mafiaTeammateIds;
      setMafiaTeammateIds(
        Array.isArray(mates) ? mates.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean) : null,
      );
      // Historia „Podglądu live” mastera trzymana na serwerze — po odświeżeniu
      // strony odtwarzamy ją w całości (łącznie z wpisami z czasu bycia offline).
      if (Array.isArray(res.insightLog)) {
        setInsightFeed((prev) => mergeInsights(res.insightLog, prev));
      }
      // Gra już zakończona (np. odświeżenie strony po "Zakończ grę") — pokaż ekran końca gry.
      if (res.status === 'finished') {
        setGameOver((prev) => ({
          winner: res.winner ?? null,
          roles: res.roles,
          summary: res.summary ?? prev?.summary ?? null,
        }));
      } else if (res.status === 'in_progress') {
        // Nowa gra wystartowała, a ten ekran wciąż pokazywał koniec poprzedniej.
        setGameOver(null);
        setMasterInLobby(false);
      } else if (res.status === 'lobby') {
        // Pokój wrócił do lobby (np. telefon spał, gdy master kliknął „Wróć do pokoju”).
        // Ekran końca gry zostaje do obejrzenia; bez niego — od razu do pokoju.
        setMasterInLobby(true);
        if (!gameOverRef.current) router.replace(`/room/${code}`);
      }
    }
    initialLoadDone.current = true;
    setStateLoaded(true);
    // Pierwszy udany stan kończy ekran „Synchronizuję…” — od razu widać werdykt.
    if (res?.ok) setSyncing(false);
    return Boolean(res?.ok);
  }, [emit, user?.id, router, code]);

  // Po wygaszeniu ekranu strona jest zamrożona: eventy z tego czasu przepadają,
  // a websocket bywa martwy tylko po stronie serwera („zombie” — klient nadal
  // uważa się za połączony). Po powrocie dociągamy stan z krótkim limitem, a
  // gdy nie odpowie, restartujemy połączenie; wtedy efekt na `connected`
  // wykona join_room i pełne odświeżenie.
  useEffect(() => {
    let hiddenAt = null;
    let syncTimer = null;

    function endSyncLater() {
      clearTimeout(syncTimer);
      // Twardy limit: po ~4 s pokazujemy dane takie, jakie są.
      syncTimer = setTimeout(() => setSyncing(false), 4000);
    }

    async function resync(e) {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        // Zasłona stawiana SYNCHRONICZNIE przy wygaszaniu (bez renderu Reacta):
        // przeglądarka po odblokowaniu najpierw pokazuje zamrożoną ostatnią klatkę
        // (z rolą), a dopiero potem wykonuje JS. Zasłona jest już w tej klatce.
        if (!isMasterRef.current) document.documentElement.dataset.privacyCover = '1';
        return;
      }
      if (document.visibilityState !== 'visible') return;
      // pageshow z bfcache (persisted) = strona była zamrożona; zwykły pageshow
      // przy pierwszym ładowaniu obsługuje efekt na `connected`.
      const wasHidden = hiddenAt !== null || e?.persisted === true;
      if (!wasHidden) {
        delete document.documentElement.dataset.privacyCover;
        return;
      }
      const hiddenMs = hiddenAt !== null ? Date.now() - hiddenAt : Infinity;
      hiddenAt = null;

      // Dłuższa nieobecność → neutralny ekran zamiast starej roli/stanu.
      // Zasłonę zdejmuje efekt na `syncing` dopiero, gdy neutralny ekran jest
      // wyrenderowany (bez „mignięcia” starej roli między jednym a drugim).
      if (hiddenMs > 1000) {
        setSyncing(true);
        endSyncLater();
      } else {
        delete document.documentElement.dataset.privacyCover;
      }

      if (!isConnected()) {
        // Socket martwy — łączymy od razu; efekt na `connected` zrobi join_room +
        // loadState (i zdejmie ekran synchronizacji).
        reconnect();
        return;
      }
      // Socket „żyje” według klienta — sprawdzamy to krótkim get_game_state;
      // brak odpowiedzi = zombie, restartujemy połączenie.
      const ok = await loadState({ timeoutMs: 1300 });
      if (!ok) reconnect();
    }

    document.addEventListener('visibilitychange', resync);
    window.addEventListener('pageshow', resync);
    return () => {
      delete document.documentElement.dataset.privacyCover;
      clearTimeout(syncTimer);
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('pageshow', resync);
    };
  }, [loadState, reconnect, isConnected]);

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
        setCards(data.cards ?? []);
        // Kolejna gra w tym samym pokoju — zamykamy ekran końca poprzedniej.
        setGameOver(null);
        setMasterInLobby(false);
        setInsightFeed([]);
        loadState();
      }),
      on('room_reset_to_lobby', () => {
        setMasterInLobby(true);
      }),
      on('phase_changed', (data) => {
        setPhase(data.phase);
        setTurn(data.turn ?? 0);
        setTurnCount(data.turnCount ?? 1);
        setRound(data.round);
        setPhaseDeadline(data.phaseDeadline ?? null);
        setNextPhase(data.nextPhase ?? null);
        setCardPrompt(null);
        setCardNightResult(null);
        setShowCardModal(false);
        setActionSubmitted(false);
        setVoteSubmitted(false);
        setMyVoteTarget(null);
        setNightResult(undefined);
        setSubmissions({});
        setMafiaDisagreement(null);
        setMafiaVotes({});
        setMafiaDayVotes({});
        setVoteStatus({});
        setShowActionOverlay(false);
        // Wynik należy do fazy rozstrzygnięcia — serwer emituje `phase_changed`
        // tuż przed `night_resolved`/`vote_resolved`, więc czyszczenie tutaj
        // kasuje poprzedni werdykt, a nowy zaraz go zastąpi.
        setPhaseResult(null);
        // Start nocy lekarza: odśwież „ostatnio leczony(a)” (blokada powtórki).
        if (data.phase === 'night_doctor' || data.phase === 'night_mafia') loadState();
        // Tura karty: prompt (cele, typ karty) przychodzi ze stanu — odśwież po wejściu w fazę.
        if (CARD_PHASES.includes(data.phase) || data.phase === 'day_vote') loadState();
      }),
      // Master: ktoś zgłosił użycie karty — odśwież kolejkę i przegląd kart.
      on('card_queue_update', (data) => {
        setCardQueue(data);
        loadState();
      }),
      // Gracz przejął nieużytą kartę wyeliminowanego współgracza z drużyny.
      on('cards_updated', (data) => {
        setCards(data.cards ?? []);
        if (data.received?.length) {
          const names = data.received.map((c) => CARD_INFO[c.type]?.name || c.type).join(', ');
          setActionError(`Przejęto kartę mocy wyeliminowanego gracza: ${names}.`);
        }
      }),
      // Prywatny wynik użytej Tarczy (czy uratowała i kim był wskazany gracz).
      on('card_shield_result', (entry) => {
        setCardLog((prev) => [...prev, entry]);
      }),
      on('night_action_submitted', (data) => {
        setSubmissions((prev) => ({ ...prev, [data.role]: data }));
      }),
      on('vote_submitted', (data) => {
        setVoteStatus((prev) => ({ ...prev, [data.voterId]: new Date() }));
      }),
      on('vote_retracted', (data) => {
        setVoteStatus((prev) => {
          const next = { ...prev };
          delete next[data.voterId];
          return next;
        });
      }),
      on('night_resolved', (data) => {
        const verdict = {
          kind: 'night',
          eliminatedPlayerId: data.eliminatedPlayerId ?? null,
          survivedNight: data.survivedNight,
        };
        setPhaseResult(verdict);
        // Osobny stan, którego phase_changed nie kasuje — źródło dla nakładki
        // pokazywanej graczom po wejściu w dyskusję.
        setNightVerdict(verdict);
        if (data.eliminatedPlayerId) {
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === data.eliminatedPlayerId ? { ...p, eliminated: true } : p,
            ),
          );
          setRecentlyEliminatedId(data.eliminatedPlayerId);
          setTimeout(() => setRecentlyEliminatedId(null), 3000);
        }
      }),
      on('vote_resolved', (data) => {
        setPhaseResult({
          kind: 'vote',
          eliminatedPlayerId: data.eliminatedPlayerId ?? null,
          outcome: data.outcome,
        });
        if (data.eliminatedPlayerId) {
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === data.eliminatedPlayerId ? { ...p, eliminated: true } : p,
            ),
          );
          setRecentlyEliminatedId(data.eliminatedPlayerId);
          setTimeout(() => setRecentlyEliminatedId(null), 3000);
        }
      }),
      on('game_over', (data) => {
        setGameOver(data);
        setPlayers((prev) =>
          prev.map((p) => ({ ...p, role: data.roles?.[p.id] })),
        );
      }),
      on('player_joined', (data) => {
        // Event nie niesie avatarów — zachowujemy te, które już znamy.
        setPlayers((prev) => {
          const known = new Map(prev.map((p) => [p.id, p.avatarUrl]));
          return withAvatars(
            (data.players || []).map((p) => ({ ...p, avatarUrl: p.avatarUrl ?? known.get(p.id) ?? null })),
          );
        });
      }),
      // Mafia: po każdym głosie wspólnika. Brak jednomyślności → odblokuj ponowny wybór.
      on('mafia_vote_update', (data) => {
        const votes = data.votes || {};
        setMafiaVotes(votes);
        if (data.waitingForConsensus) {
          setMafiaDisagreement({ votes });
        } else {
          setMafiaDisagreement(null);
        }
        // „Złożony” = mam aktywny głos i nie ma niezgody (jak na serwerze).
        // Cofnięty głos (brak klucza) albo niezgoda odblokowują ponowny wybór.
        if (user?.id) {
          setActionSubmitted(Boolean(votes[user.id]) && !data.waitingForConsensus);
        } else if (data.waitingForConsensus) {
          setActionSubmitted(false);
        }
      }),
      on('mafia_day_votes', (data) => {
        setMafiaDayVotes(data.votes || {});
      }),
      on('master_game_insight', (data) => {
        setInsightFeed((prev) => mergeInsights(prev, [data]));
      }),
    ];

    return () => offs.forEach((off) => off?.());
  }, [connected, code, emit, on, loadState, user?.id]);

  // Nakładka z werdyktem nocy na starcie fazy dyskusji. Dyskusja jest długa, więc
  // gracz najpierw czyta wynik nocy na pełnym ekranie, a pod spodem już leci faza.
  // Efekt ustawia widoczność diva na true, gdy tylko gracz wejdzie w dyskusję z
  // gotowym werdyktem; przycisk „Zatwierdź” zmienia stan na false i div znika.
  //
  // `sessionStorage` (per pokój+runda) pamięta zamknięcie: gdy telefon spał w
  // trakcie rozstrzygnięcia, po odblokowaniu i odświeżeniu nakładka wciąż się
  // pokaże, ale po świadomym „Zatwierdź” kolejne odświeżenia już jej nie wznowią.
  const verdictSeenKey =
    round != null ? `nightVerdictSeen:${code}:${round}` : null;

  useEffect(() => {
    if (phase !== 'day_deliberation' || isMaster || !nightVerdict) return;
    if (verdictSeenKey && typeof window !== 'undefined') {
      try {
        if (sessionStorage.getItem(verdictSeenKey)) return;
      } catch {
        /* brak dostępu do sessionStorage — po prostu pokaż nakładkę */
      }
    }
    setShowNightVerdict(true);
  }, [phase, isMaster, nightVerdict, verdictSeenKey]);

  function dismissNightVerdict() {
    setShowNightVerdict(false);
    if (verdictSeenKey && typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(verdictSeenKey, '1');
      } catch {
        /* brak dostępu do sessionStorage — nakładka po prostu wróci przy odświeżeniu */
      }
    }
  }

  const ACTION_ERRORS = {
    wrong_phase: 'Zła faza gry — spróbuj ponownie.',
    already_acted: 'Już wykonałeś(aś) akcję w tej turze.',
    already_checked: 'Ten gracz został już przez Ciebie sprawdzony.',
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
    not_mafia: 'Tylko mafia może cofnąć głos.',
    no_vote: 'Nie masz głosu do cofnięcia.',
    nothing_to_retract: 'Nie masz głosu do cofnięcia.',
    no_room: 'Nie znaleziono pokoju — odśwież stronę.',
  };

  async function handleRetractVote() {
    setActionError(null);
    const res = await emit('mafia_retract_vote', {});
    if (res?.ok) {
      setActionSubmitted(false);
      setMafiaVotes((prev) => {
        const next = { ...prev };
        if (user?.id) delete next[user.id];
        return next;
      });
    } else {
      setActionError(ACTION_ERRORS[res?.error] || `Nie udało się cofnąć głosu: ${res?.error || 'brak połączenia'}`);
    }
  }

  async function handleNightAction(targetId) {
    setActionError(null);
    const res = await emit('night_action', { targetId });
    if (res?.ok) {
      if (role === 'mafia') {
        // Czy głos jest „złożony”, rozstrzyga `mafia_vote_update` (przy niezgodzie
        // wybór zostaje odblokowany) — nie nadpisujemy tego tutaj.
        if (user?.id) setMafiaVotes((prev) => ({ ...prev, [user.id]: targetId }));
      } else {
        setActionSubmitted(true);
      }
      if (role === 'doctor') {
        setDoctorHistory((prev) => [...prev, { targetId }]);
      }
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
      setMyVoteTarget(targetId ?? null);
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

  async function handleRetractDayVote() {
    setActionError(null);
    const res = await emit('retract_vote', {});
    if (res?.ok) {
      setVoteSubmitted(false);
      setMyVoteTarget(null);
    } else {
      setActionError(ACTION_ERRORS[res?.error] || `Nie udało się cofnąć głosu: ${res?.error || 'brak połączenia'}`);
    }
  }

  async function handleDeclareCard(card) {
    const res = await emit('card_declare', { type: card.type, cardId: card.id });
    if (res?.ok) loadState();
    return res;
  }

  async function handleCardNightAction(payload) {
    setActionError(null);
    const res = await emit('card_night_action', payload);
    if (res?.ok) {
      setCardNightResult(res.result ?? { done: true });
      if (res.result?.kind === 'reveal') {
        setCardLog((prev) => [
          ...prev,
          { kind: 'reveal', round, targetId: res.result.targetId, role: res.result.role },
        ]);
      } else if (res.result) {
        setCardLog((prev) => [
          ...prev,
          { kind: 'check', round, targetIds: res.result.targetIds, count: res.result.count },
        ]);
      }
    } else {
      const msgs = {
        wrong_phase: 'Zła faza gry.',
        not_your_turn: 'To nie Twoja tura.',
        already_acted: 'Karta została już użyta.',
        invalid_targets: 'Wybierz dokładnie wymaganą liczbę graczy.',
        invalid_target: 'Nieprawidłowy cel.',
        eliminated: 'Jesteś wyeliminowany(a).',
        no_queued_card: 'Ta karta nie została zgłoszona.',
      };
      setActionError(msgs[res?.error] || `Błąd: ${res?.error || 'brak połączenia'}`);
    }
    return res;
  }

  async function handleAdvancePhase() {
    // `from` chroni przed przeskoczeniem fazy przy podwójnym kliknięciu lub
    // retry — serwer odrzuci żądanie, jeśli faza zdążyła się już zmienić.
    const res = await emit('advance_phase', { from: phase, fromTurn: turn });
    // Odrzucone duplikaty (podwójny tap / retry) nie są błędem — faza albo już
    // się zmieniła, albo trwa minimalny czas rozstrzygnięcia. Nie alarmujemy.
    const ignored = ['stale_phase', 'advance_in_progress', 'resolve_too_soon', 'votes_missing'];
    if (!res?.ok && !ignored.includes(res?.error)) {
      alert(`Nie udało się zmienić fazy: ${res?.error || 'nieznany błąd'}`);
    }
  }

  // Potwierdzenie jak w MasterControls — ekran wyniku wywołuje end_game bezpośrednio.
  async function handleEndGameConfirmed() {
    if (!confirm('Na pewno zakończyć rozgrywkę? Wszyscy gracze zobaczą ekran końca gry.')) return;
    await handleEndGame();
  }

  async function handleEndGame() {
    const res = await emit('end_game', {});
    if (!res?.ok) {
      alert(`Nie udało się zakończyć gry: ${res?.error || 'nieznany błąd'}`);
    }
  }

  // Z kilkoma detektywami/lekarzami każdy ma własną turę w fazie.
  const isMyTurn = myTurnIndex == null || turn === myTurnIndex;
  const isNightPhaseForRole =
    (role === 'detective' && phase === 'night_detective' && isMyTurn) ||
    (role === 'doctor' && phase === 'night_doctor' && isMyTurn) ||
    (role === 'mafia' && phase === 'night_mafia');

  // Tura karty (Sprawdzenie / karta mafii) — prompt z serwera tylko dla gracza, który ma teraz ruch.
  const isCardTurn = Boolean(cardPrompt) && CARD_PHASES.includes(phase);
  const advancedMode = roomSettings?.advanced_mode === true;

  // Master widzi czat mafii na żywo (podgląd bez możliwości pisania) —
  // egzekwowane też po stronie serwera w socket/chat.js.
  const chatChannel =
    (role === 'mafia' || isMaster) && phase === 'night_mafia' ? 'mafia_night' : null;

  // Głosowanie / detektyw / mafia: bez siebie. Lekarz: siebie, gdy ustawienie na to pozwala.
  const canDoctorSelfProtect = roomSettings?.doctor_can_self_protect !== false;
  const alivePlayers = players.filter((p) => {
    if (p.eliminated || p.isMaster) return false;
    if (p.id === user?.id) {
      return role === 'doctor' && phase === 'night_doctor' && canDoctorSelfProtect;
    }
    return true;
  });
  const doctorRepeatBlocked =
    role === 'doctor' && roomSettings?.doctor_repeat_protect === false
      ? lastDoctorTarget
      : null;

  // Fazy rozstrzygnięcia mają własny, pełnoekranowy widok wyniku (zamiast
  // ulotnego popupu) — trwa on tak długo, jak faza, więc gracz z wygaszonym
  // ekranem zobaczy werdykt po odblokowaniu telefonu.
  const isResolvePhase = phase === 'night_resolve' || phase === 'day_resolve';

  // Podczas dyskusji, głosowania i rozstrzygnięć chowamy rolę i kolor tła, żeby
  // gracze nie mogli odczytać roli z ekranu leżącego na stole telefonu.
  const isPrivacyPhase =
    phase === 'day_deliberation' || phase === 'day_vote' || isResolvePhase;
  const hideRoleScreen = !isMaster && isPrivacyPhase;

  // Rola (tekst i kolor tła) jest widoczna wyłącznie w fazie „role_reveal” albo
  // dopóki gracz przytrzymuje przycisk podglądu. W każdej innej fazie ekran jest
  // neutralny — dzięki temu zamrożona klatka po odblokowaniu telefonu (której nie
  // da się przykryć z poziomu strony) nigdy nie zawiera roli.
  const maskRole = !isMaster && phase !== 'role_reveal' && !peekRole;

  const bgClass = isMaster
    ? ROLE_BG.master
    : hideRoleScreen || maskRole
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
      (isCardTurn && !cardNightResult) ||
      (phase === 'day_vote' && !voteSubmitted));

  const actionDone =
    !isMaster &&
    !isEliminated &&
    ((isNightPhaseForRole && actionSubmitted) ||
      (isCardTurn && Boolean(cardNightResult)) ||
      (phase === 'day_vote' && voteSubmitted));

  const showMafiaDisagreement =
    role === 'mafia' && phase === 'night_mafia' && !isEliminated && Boolean(mafiaDisagreement);
  const nameOf = (id) => players.find((p) => p.id === id)?.username || '—';
  const mafiaDisagreementBanner = showMafiaDisagreement ? (
    <div className="card bg-flame-500/30 border border-blood/40 text-paper-100 text-sm py-3 px-3 space-y-1">
      <p className="font-semibold">⚠ Brak jednomyślnego wyroku</p>
      <p>Mafia wybrała różne cele. Uzgodnijcie jeden cel na czacie i wybierzcie ponownie.</p>
    </div>
  ) : null;

  // Głosy mafii widoczne przez całą noc mafii (nie tylko przy niezgodzie).
  const showMafiaVotes =
    role === 'mafia' && (phase === 'night_mafia' || phase === 'day_vote') && !isEliminated;
  const mafiaVotesSummary = showMafiaVotes ? (
    <MafiaVotesSummary
      votes={phase === 'day_vote' ? mafiaDayVotes : mafiaVotes}
      currentUserId={user?.id}
      teammateIds={mafiaTeammateIds}
      nameOf={nameOf}
      className="card py-3 px-3"
    />
  ) : null;

  // Dolny przycisk akcji: „Wykonaj” (noc) / „Głosuj” / „Zmień głos” (mafia po złożeniu).
  const mafiaCanChange =
    (role === 'mafia' && phase === 'night_mafia' && actionDone) ||
    (phase === 'day_vote' && voteSubmitted && actionDone);
  const showActionButton =
    !isMaster && !isEliminated && (needsAction || mafiaCanChange);
  const actionButtonLabel = showActionOverlay
    ? 'Zamknij'
    : mafiaCanChange
    ? 'Zmień głos'
    : isCardTurn
    ? 'Użyj karty'
    : isNightPhaseForRole
    ? 'Wykonaj'
    : 'Głosuj';
  const ACTION_ICONS = { detective: '🔍', doctor: '💉', mafia: '🎯' };
  const actionButtonIcon = showActionOverlay
    ? '✕'
    : isCardTurn
    ? '🃏'
    : mafiaCanChange || isNightPhaseForRole
    ? ACTION_ICONS[role] || '▶'
    : '🗳️';
  // Ikona roli w prawym dolnym rogu — tylko tam, gdzie rola jest widoczna na ekranie.
  const showCornerMenu =
    !isMaster && !isEliminated && !hideRoleScreen && ['detective', 'doctor', 'mafia'].includes(role);

  // Wysokość dolnego panelu — nakładka akcji kończy się nad nim.
  const [bottomH, setBottomH] = useState(0);
  const bottomObserver = useRef(null);
  const bottomRef = useCallback((node) => {
    bottomObserver.current?.disconnect();
    bottomObserver.current = null;
    if (!node) {
      setBottomH(0);
      return;
    }
    const update = () => setBottomH(node.offsetHeight);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      bottomObserver.current = new ResizeObserver(update);
      bottomObserver.current.observe(node);
    }
  }, []);

  // Nocna tura mafii: kto ze współmafiosów już nie żyje (np. wyrzucony w głosowaniu).
  const fallenMafia =
    role === 'mafia' && phase === 'night_mafia' && !isEliminated
      ? mafiaFallen.filter((id) => id !== user?.id)
      : [];
  const mafiaFallenNotice =
    fallenMafia.length > 0 ? (
      <div className="card py-3 px-3 text-sm text-paper-100/80">
        <p className="font-semibold">
          ☠ {fallenMafia.length === 1 ? 'Nie ma już w grze mafiosa' : 'Nie ma już w grze mafiosów'}:
        </p>
        <p className="text-white/60">{fallenMafia.map((id) => nameOf(id)).join(', ')}</p>
      </div>
    ) : null;

  const waitingLabel = actionDone
    ? (ACTION_WAITING[phase] || 'Czekaj na mastera…')
    : null;

  // Komunikaty po akcji (lekarz, detektyw, mafia, głos) są chwilowe — stałe
  // informacje gracz ma w dzienniku, a po odblokowaniu ekranu nie mają wisieć.
  const showWaiting = useTransient(
    actionDone && waitingLabel ? `${round}:${phase}:${turn}:${String(nightResult?.is_mafia)}` : null,
    6000,
  );

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

  // Powrót z tła: zamiast nieaktualnej roli (prywatność + mylący stan) pokazujemy
  // neutralny ekran, dopóki nie dojdzie świeży stan z serwera.
  if (syncing) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-3 bg-night" role="status">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
        <p className="text-white/30 text-xs">Synchronizuję…</p>
      </div>
    );
  }

  if (gameOver) {
    return (
      <GameOverScreen
        gameOver={gameOver}
        players={players}
        round={round}
        isMaster={isMaster}
        masterInLobby={masterInLobby}
        onReturnToRoom={handleReturnToRoom}
        onHome={handleGoHome}
      />
    );
  }

  return (
    <div className={`h-dvh overflow-hidden flex flex-col ${bgClass}`}>
      {/* Top — logo M + leave button */}
      <header className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2 border-b border-brass-500/15">
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
      <main
        key={isMaster ? 'master' : phase ?? 'none'}
        className={`flex-1 min-h-0 overflow-hidden ${isMaster ? '' : 'animate-phase-fade'}`}
      >
        {isMaster && isResolvePhase ? (
          /* ── Master: ten sam ekran wyniku, ale z przyciskiem kończącym fazę ── */
          <PhaseResultScreen
            result={phaseResult}
            players={players}
            currentUserId={user?.id}
            round={round}
            onAdvance={handleAdvancePhase}
            advanceLabel={
              phase === 'night_resolve' ? 'Rozpocznij dyskusję' : 'Rozpocznij kolejną rundę'
            }
            onEndGame={handleEndGameConfirmed}
          />
        ) : isMaster ? (
          /* ── Master: two-column layout ── */
          <div className="h-full grid grid-cols-2 gap-3 p-3 overflow-hidden">
            {/* Left: controls + insight feed */}
            <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
              <div className="shrink-0">
                <MasterControls
                  phase={phase}
                  round={round}
                  turn={turn}
                  turnCount={turnCount}
                  phaseDeadline={phaseDeadline}
                  submissions={submissions}
                  voteStatus={voteStatus}
                  players={players}
                  nextPhase={nextPhase}
                  cardQueue={cardQueue}
                  cardsOverview={cardsOverview}
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
            <div className="relative flex flex-col gap-2 min-h-0">
              <div className="flex items-center gap-2 shrink-0">
                <h3 className="section-eyebrow">
                  Gracze
                </h3>
                <span className="text-[12px] text-white/30">
                  {players.filter((p) => !p.isMaster && !p.eliminated).length} żywych /{' '}
                  {players.filter((p) => !p.isMaster).length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <PlayerList
                  players={players.filter((p) => !p.isMaster)}
                  showRoles
                  gridLayout
                  highlightKilledId={
                    phase === 'day_deliberation' ? nightVerdict?.eliminatedPlayerId ?? null : null
                  }
                  votingStatus={phase === 'day_vote' ? voteStatus : null}
                />
              </div>
              {chatChannel && (
                <MafiaChatDrawer
                  channel={chatChannel}
                  roomCode={code}
                  readOnly
                  label="Dziupla Mafii — podgląd"
                  className="shrink-0"
                  panelClassName="h-[60%] min-h-[12rem]"
                />
              )}
            </div>
          </div>
        ) : isResolvePhase ? (
          /* ── Player: pełnoekranowy wynik rozstrzygnięcia ── */
          <PhaseResultScreen
            result={phaseResult}
            players={players}
            currentUserId={user?.id}
            round={round}
          />
        ) : (
          /* ── Player: role center + status ── */
          <div className="h-full flex flex-col items-center justify-center px-6 gap-4">
            {hideRoleScreen || maskRole ? (
              <>
                <p className="section-eyebrow !tracking-[0.3em]">Runda {round}</p>
                <h1 className="font-display text-[clamp(1.75rem,11vw,3.75rem)] max-w-full text-center leading-tight font-bold capitalize text-white">
                  {hideRoleScreen ? roundTitleLabel : phase?.startsWith('night') ? 'Noc' : roundTitleLabel}
                </h1>
              </>
            ) : (
              <>
                <p className="section-eyebrow !tracking-[0.3em]">Twoja rola</p>
                <h1
                  className={`font-display text-[clamp(1.75rem,11vw,3.75rem)] max-w-full text-center leading-tight font-bold capitalize ${roleColorClass}`}
                >
                  {roleLabel}
                </h1>
              </>
            )}

            {/* Informacje o rundzie — część głównego ekranu (faza, opis, timer) */}
            <div className="flex flex-col items-center gap-2">
              <PhaseBadge phase={phase} round={round} />
              <p className="text-white/55 text-sm text-center italic max-w-xs">
                {PHASE_FLAVOR[phase] ?? PHASE_FLAVOR.null}
              </p>
              <TurnTimer phaseDeadline={phaseDeadline} phase={phase} sizeClass="text-3xl" />
            </div>

            {/* Podgląd roli: przycisk jest ZAWSZE zamontowany (także w trakcie podglądu),
                a puszczenie łapiemy na oknie — inaczej znikał razem z ukrytą rolą. */}
            {!isMaster && !hideRoleScreen && phase !== 'role_reveal' && (
              <button
                type="button"
                className="btn-ghost select-none touch-none"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setPeekRole(true);
                }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {peekRole ? 'Puść, aby ukryć rolę' : 'Przytrzymaj, aby zobaczyć rolę'}
              </button>
            )}

            {/* Karty mocy przydzielone na starcie — widoczne tylko na ekranie roli */}
            {phase === 'role_reveal' && cards.length > 0 && !isEliminated && (
              <div className="w-full max-w-sm card py-3 px-3 text-sm space-y-1 text-center">
                <p className="section-eyebrow">Karta mocy</p>
                {cards.map((c) => (
                  <p key={c.id || c.type} className="text-white/85">
                    <span aria-hidden>{CARD_INFO[c.type]?.icon}</span> Otrzymałeś(aś) kartę „
                    {CARD_INFO[c.type]?.name || c.type}”
                    <span className="block text-xs text-white/45">{CARD_INFO[c.type]?.how}</span>
                  </p>
                ))}
                <p className="text-xs text-white/40">
                  Użyjesz jej przyciskiem „Użyj karty” podczas głosowania.
                </p>
              </div>
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
            {!isEliminated && actionDone && waitingLabel && showWaiting && (
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

            {mafiaDisagreementBanner && !showActionOverlay && (
              <div className="mt-4 w-full max-w-sm">{mafiaDisagreementBanner}</div>
            )}

            {mafiaFallenNotice && !showActionOverlay && (
              <div className="mt-2 w-full max-w-sm">{mafiaFallenNotice}</div>
            )}

            {mafiaVotesSummary && !showActionOverlay && (
              <div className="mt-2 w-full max-w-sm">{mafiaVotesSummary}</div>
            )}
          </div>
        )}
      </main>

      {/* Bottom — przycisk akcji, ikona roli (prawy dolny róg) i pasek rundy */}
      {!isMaster && (
        <div ref={bottomRef} className="relative z-50 shrink-0">
          {showCornerMenu && (
            <RoleCornerMenu
              role={role}
              players={players}
              meId={user?.id}
              detectiveHistory={detectiveHistory}
              doctorHistory={doctorHistory}
              lastDoctorTarget={lastDoctorTarget}
              roomSettings={roomSettings}
              chatChannel={chatChannel}
              roomCode={code}
            />
          )}
          <div className="px-4 pt-3 pb-4 bg-ink-900/85 border-t border-brass-500/25 backdrop-blur-md space-y-2">
            {/* Tryb zaawansowany: przycisk widoczny dla wszystkich w głosowaniu, żeby jego
                naciśnięcie niczego nie zdradzało — gracz bez karty dostanie tylko informację. */}
            {advancedMode && phase === 'day_vote' && !isEliminated && (
              <button
                type="button"
                onClick={() => setShowCardModal(true)}
                className="w-full inline-flex items-center justify-center gap-2 btn-secondary"
              >
                <span aria-hidden>🃏</span>
                Użyj karty
              </button>
            )}
            {showActionButton ? (
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setShowActionOverlay((v) => !v);
                }}
                className={`w-full inline-flex items-center justify-center gap-2 ${
                  showActionOverlay ? 'btn-ghost' : 'btn-primary'
                }`}
              >
                <span aria-hidden>{actionButtonIcon}</span>
                {actionButtonLabel}
              </button>
            ) : (
              <div className="h-[2.75rem]" aria-hidden />
            )}
          </div>
        </div>
      )}

      {/* Werdykt nocy jako nakładka na starcie dyskusji — pod nią już trwa faza */}
      {showNightVerdict && !isMaster && nightVerdict && (
        <div className="fixed inset-0 z-40 bg-night animate-reveal-in">
          <PhaseResultScreen
            result={nightVerdict}
            players={players}
            currentUserId={user?.id}
            round={round}
            onAdvance={dismissNightVerdict}
            advanceLabel="Zatwierdź"
          />
        </div>
      )}

      {/* Action overlay */}
      {showActionOverlay && !isMaster && !isEliminated && (
        <div
          className="fixed inset-x-0 top-0 z-40 flex items-end sm:items-center justify-center"
          style={{ bottom: bottomH }}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => { setShowActionOverlay(false); setActionError(null); }}
            aria-label="Zamknij"
          />
          <div className="relative w-full max-w-lg mx-4 mb-4 sm:mb-0 max-h-[calc(100%-1rem)] min-h-0 overflow-hidden animate-popup-in gap-2 flex flex-col">
            {/* Error banner */}
            {actionError && (
              <div key={actionError} className="card bg-flame-500/30 border border-blood/40 text-paper-100 text-sm py-2 px-3 animate-shake">
                ⚠ {actionError}
              </div>
            )}
            {isNightPhaseForRole && (
              <NightActionPicker
                role={role}
                players={
                  role === 'detective'
                    ? alivePlayers.filter(
                        (p) => !detectiveHistory.some((h) => h.targetId === p.id),
                      )
                    : alivePlayers
                }
                onSubmit={handleNightAction}
                disabled={actionSubmitted}
                result={nightResult}
                doctorBlockedId={doctorRepeatBlocked}
                mafiaVotes={role === 'mafia' ? mafiaVotes : null}
                mafiaTeammateIds={role === 'mafia' ? mafiaTeammateIds : null}
                currentUserId={user?.id}
                onRetract={role === 'mafia' ? handleRetractVote : null}
              />
            )}
            {isCardTurn && (
              <CardNightPicker
                key={`${phase}-${turn}-${cardPrompt?.type}`}
                prompt={cardPrompt}
                players={players}
                onSubmit={handleCardNightAction}
                result={cardNightResult}
                error={null}
              />
            )}
            {phase === 'day_vote' && (
              <VotePanel
                players={alivePlayers}
                onVote={handleVote}
                onRetract={handleRetractDayVote}
                hasVoted={voteSubmitted}
                myVoteTarget={myVoteTarget}
              />
            )}
          </div>
        </div>
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
        onProfileSaved={() => loadState()}
        cards={cards}
        cardLog={cardLog}
        mafiaCard={mafiaCard}
        round={round}
      />

      <CardUseModal
        open={showCardModal && !isMaster}
        onClose={() => setShowCardModal(false)}
        cards={cards}
        round={round}
        onDeclare={handleDeclareCard}
      />

      {/* Leave game confirmation */}
      <AnimatedModal open={showLeaveConfirm} onClose={() => setShowLeaveConfirm(false)}>
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
                className="btn-ghost w-full"
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
      </AnimatedModal>
    </div>
  );
}
