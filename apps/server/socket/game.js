import { rooms } from '../game/state.js';
import { assignRoles, roleLimits, findRoleLimitViolation } from '../game/roles.js';
import { turnIndexOf, turnCount } from '../game/turns.js';
import { roomEventMeta, emitMasterInsight } from '../game/events.js';
import { processNightAction, processVote, retractMafiaVote, retractVote } from '../game/actions.js';
import {
  assignCards,
  resetCardState,
  cardsFor,
  cardsOverview,
  cardQueueFor,
  cardPromptFor,
  mafiaCardInfo,
  declareCard,
  performCardNightAction,
  ensureCardState,
} from '../game/cards.js';
import { buildRoomPlayerList } from '../game/roomPlayers.js';
import { ensureAdminAuth } from '../lib/pocketbase.js';
import { scheduleLobbyRemoval } from '../game/lobbyGrace.js';
import {
  advancePhaseInternal,
  clearPhaseTimer,
  emitGameOver,
  getMissingVoterIds,
  phaseMeta,
  tryAutoAdvance,
} from '../game/phaseFlow.js';

export function registerGameHandlers(io, socket, pb) {
  socket.on('start_game', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      if (socket.userId !== state.hostId) return callback?.({ ok: false, error: 'not_master' });
      if (state.players.size < (state.settings?.min_players || 4)) {
        return callback?.({ ok: false, error: 'not_enough_players' });
      }

      for (const [, p] of state.players.entries()) {
        if (p.isBot) continue;
        if (!p.socketId) {
          return callback?.({ ok: false, error: 'player_offline' });
        }
      }

      const participantIds = Array.from(state.players.keys()).filter((id) => id !== state.hostId);
      const roleOverrides = (data && typeof data === 'object') ? (data.roleOverrides || {}) : {};
      const violation = findRoleLimitViolation(participantIds, roleOverrides, state.settings);
      if (violation) {
        return callback?.({ ok: false, error: 'role_limit_exceeded', role: violation.role, limit: violation.limit });
      }
      const roleMap = assignRoles(participantIds, roleOverrides, state.settings);

      for (const [userId, role] of Object.entries(roleMap)) {
        const rpRecords = await pb.collection('room_players').getList(1, 1, {
          filter: `room_id = "${state.id}" && user_id = "${userId}"`,
        });
        if (rpRecords.items.length > 0) {
          await pb.collection('room_players').update(rpRecords.items[0].id, { role });
        }
      }

      // Rundę tworzymy PRZED przełączeniem pokoju w in_progress — gdyby zapis do PB
      // padł (np. nieznana wartość `phase`), pokój zostaje w lobby zamiast utknąć
      // w stanie "gra wystartowała, ale nikt nie dostał eventu game_started".
      const round = await pb.collection('rounds').create({
        room_id: state.id,
        round_number: 1,
        phase: 'role_reveal',
      });

      await pb.collection('rooms').update(state.id, { status: 'in_progress' });

      state.status = 'in_progress';
      state.roles = roleMap;
      state.round = 1;
      state.phase = 'role_reveal';
      state.nightActions = {};
      state.votes = new Map();
      state.detectiveLog = new Map();
      state.mafiaTargets = new Map();
      state.mafiaWaitingForConsensus = false;
      state.previousDoctorProtectTarget = null;
      state.previousDoctorTargets = null;
      state.nightTurn = 0;
      state.eliminatedBots = new Set();
      state.botMemory = null;
      state.phaseResult = null;
      state.lastNightResult = null;
      state.resolveEnteredAt = null;
      state.advancing = false;
      state.currentRoundId = round.id;
      state.insightLog = []; // nowa gra = pusta historia podglądu live
      state.gameSummary = null;
      assignCards(state); // tryb zaawansowany: karty mocy losowane razem z rolami

      const meta = roomEventMeta(state);

      for (const [userId, pInfo] of state.players.entries()) {
        if (userId === state.hostId) continue;
        if (pInfo.isBot) continue;
        const role = roleMap[userId];
        io.to(pInfo.socketId).emit('game_started', { role, cards: cardsFor(state, userId), ...meta });
      }

      const masterInfo = state.players.get(state.hostId);
      if (masterInfo?.socketId) {
        io.to(masterInfo.socketId).emit('game_started', { role: null, isMaster: true, ...meta });
      }

      emitMasterInsight(io, state, { kind: 'roles_assigned', roles: roleMap });
      if (state.settings?.advanced_mode === true) {
        emitMasterInsight(io, state, { kind: 'cards_assigned', overview: cardsOverview(state) });
      }

      callback?.({ ok: true });
    } catch (err) {
      console.error('[game] start_game error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // Ile faza rozstrzygnięcia musi trwać, zanim master może z niej wyjść. Chroni
  // przed przypadkowym podwójnym tapnięciem, które przeskakiwało wynik nocy /
  // głosowania. Człowiek i tak czyta werdykt dłużej; drugi tap w tym oknie to
  // na pewno duplikat. Działa niezależnie od wersji frontu (nawet gdy stary
  // bundle nie wysyła `from`). Nadpisywalne przez env (testy: 0).
  const resolveMinMs = () => Number(process.env.MAFIA_RESOLVE_MIN_MS ?? 800);

  socket.on('advance_phase', async (data, callback) => {
    const state = rooms.get(socket.roomId);
    if (!state) return callback?.({ ok: false, error: 'no_room' });
    if (socket.userId !== state.hostId) return callback?.({ ok: false, error: 'not_master' });
    if (state.status !== 'in_progress') return callback?.({ ok: false, error: 'game_not_started' });

    // Jedno kliknięcie = jedna faza. Podwójny tap na telefonie albo dwie karty
    // mastera potrafiły przeskoczyć całą fazę — najdotkliwiej rozstrzygnięcie
    // nocy/głosowania, którego gracze wtedy w ogóle nie zobaczyli.
    const from = data && typeof data === 'object' ? data.from : undefined;
    const fromTurn = data && typeof data === 'object' ? data.fromTurn : undefined;
    const staleTurn =
      Number.isInteger(fromTurn) && fromTurn !== (state.nightTurn ?? 0);
    if ((from !== undefined && from !== state.phase) || staleTurn) {
      return callback?.({ ok: false, error: 'stale_phase', phase: state.phase });
    }
    if (state.advancing) {
      return callback?.({ ok: false, error: 'advance_in_progress', phase: state.phase });
    }

    const isResolve = state.phase === 'night_resolve' || state.phase === 'day_resolve';
    if (isResolve && state.resolveEnteredAt) {
      const elapsed = Date.now() - state.resolveEnteredAt;
      if (elapsed < resolveMinMs()) {
        console.log(
          `[game] advance_phase odrzucony (double-tap): faza=${state.phase}, elapsed=${elapsed}ms`,
        );
        return callback?.({ ok: false, error: 'resolve_too_soon', phase: state.phase });
      }
    }

    // Głosowanie dzienne: master nie przejdzie dalej, dopóki nie zagłosują wszyscy żywi gracze.
    if (state.phase === 'day_vote') {
      const missing = await getMissingVoterIds(state, pb);
      if (missing.length > 0) {
        return callback?.({
          ok: false,
          error: 'votes_missing',
          phase: state.phase,
          missingVoterIds: missing,
        });
      }
    }

    console.log(
      `[game] advance_phase: user=${socket.userId} from=${from ?? '—'} state.phase=${state.phase}`,
    );

    state.advancing = true;
    try {
      clearPhaseTimer(state);
      await advancePhaseInternal(io, state, pb, callback);
    } finally {
      state.advancing = false;
    }
  });

  socket.on('end_game', async (_data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      if (socket.userId !== state.hostId) {
        return callback?.({ ok: false, error: 'not_master' });
      }
      if (state.status === 'finished') {
        return callback?.({ ok: false, error: 'already_finished' });
      }
      clearPhaseTimer(state);
      await emitGameOver(io, state, 'master_ended', pb, callback);
    } catch (err) {
      console.error('[game] end_game error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // Master wraca z ekranu "koniec gry" do pokoju — resetujemy pokój tak,
  // żeby zachowywał się jak świeżo utworzony (ustawienia edytowalne, boty
  // można dodawać, role/eliminacje z poprzedniej gry wyczyszczone).
  socket.on('return_to_room', async (_data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      if (socket.userId !== state.hostId) return callback?.({ ok: false, error: 'not_master' });
      if (state.status !== 'finished') return callback?.({ ok: false, error: 'game_not_finished' });

      clearPhaseTimer(state);
      await ensureAdminAuth();
      await pb.collection('rooms').update(state.id, { status: 'lobby' });

      const participants = await pb.collection('room_players').getFullList({
        filter: `room_id = "${state.id}"`,
        requestKey: null,
      });
      for (const p of participants) {
        await pb.collection('room_players').update(p.id, { role: '', eliminated_at: null });
      }

      // Boty istnieją tylko w pamięci — usuwamy je razem z resztą stanu gry.
      for (const [userId, info] of Array.from(state.players.entries())) {
        if (info.isBot) state.players.delete(userId);
      }

      state.status = 'lobby';
      state.phase = null;
      state.round = 0;
      state.roles = {};
      state.winner = undefined;
      state.nightActions = {};
      state.votes = new Map();
      state.detectiveLog = new Map();
      state.mafiaTargets = new Map();
      state.mafiaWaitingForConsensus = false;
      state.previousDoctorProtectTarget = null;
      state.previousDoctorTargets = null;
      state.nightTurn = 0;
      state.eliminatedBots = new Set();
      state.botMemory = null;
      state.phaseResult = null;
      state.lastNightResult = null;
      state.resolveEnteredAt = null;
      state.currentRoundId = null;
      state.insightLog = [];
      state.gameSummary = null;
      resetCardState(state);

      // Gracze, którzy w trakcie gry zamknęli aplikację, dostają w lobby okres
      // karencji — inaczej wisieliby jako „offline” i blokowali start nowej gry.
      for (const [userId, info] of state.players.entries()) {
        if (userId === state.hostId || info.isBot || info.socketId) continue;
        scheduleLobbyRemoval(io, pb, state, userId);
      }

      io.to(`room:${state.code}`).emit('room_reset_to_lobby', {
        players: buildRoomPlayerList(state),
      });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[game] return_to_room error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('night_action', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      const result = await processNightAction(io, state, pb, socket.userId, data?.targetId);
      callback?.(result);
    } catch (err) {
      console.error('[game] night_action error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('mafia_retract_vote', async (_data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      const result = await retractMafiaVote(io, state, pb, socket.userId);
      callback?.(result.ok ? { ok: true } : result);
    } catch (err) {
      console.error('[game] mafia_retract_vote error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // Tryb zaawansowany: zgłoszenie użycia karty (przycisk „Użyj karty” w głosowaniu).
  socket.on('card_declare', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      const result = await declareCard(io, state, pb, socket.userId, data?.type);
      callback?.(result);
    } catch (err) {
      console.error('[game] card_declare error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // Tura karty w nocy: Sprawdzenie obywatela albo karta mafii.
  socket.on('card_night_action', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      const result = await performCardNightAction(io, state, pb, socket.userId, data || {});
      callback?.(result);
    } catch (err) {
      console.error('[game] card_night_action error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('vote', async (data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      const result = await processVote(io, state, pb, socket.userId, data?.targetId);
      callback?.(result);
    } catch (err) {
      console.error('[game] vote error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('retract_vote', async (_data, callback) => {
    try {
      const state = rooms.get(socket.roomId);
      if (!state) return callback?.({ ok: false, error: 'no_room' });
      callback?.(await retractVote(io, state, pb, socket.userId));
    } catch (err) {
      console.error('[game] retract_vote error:', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  function submissionStatus(state, userId) {
    const role = state.roles?.[userId];
    const nightActionSubmitted =
      (role === 'detective' && state.nightActions?.detective?.actorId === userId) ||
      (role === 'doctor' && state.nightActions?.doctor?.actorId === userId) ||
      // Przy braku zgody mafii głos nie jest „złożony” — mafioso musi wybrać ponownie.
      (role === 'mafia' && Boolean(state.mafiaTargets?.has(userId)) && !state.mafiaWaitingForConsensus);
    const isMafiaNight = role === 'mafia' && state.phase === 'night_mafia';
    const isMafiaDayVote = role === 'mafia' && state.phase === 'day_vote';
    return {
      mafiaDayVotes: isMafiaDayVote
        ? Object.fromEntries(
            [...(state.votes ?? [])].filter(([id]) => state.roles?.[id] === 'mafia'),
          )
        : undefined,
      nightActionSubmitted: Boolean(nightActionSubmitted),
      voteSubmitted: Boolean(state.votes?.has(userId)),
      // Na kogo oddałem głos (null = pominięcie) — do zaznaczenia przy zmianie głosu.
      myVoteTarget: state.votes?.get(userId) ?? null,
      // Dla mafii: wybory wspólników i informacja o braku jednomyślności (po odświeżeniu strony).
      mafiaVotes: isMafiaNight ? Object.fromEntries(state.mafiaTargets ?? []) : undefined,
      mafiaDisagreement: isMafiaNight ? Boolean(state.mafiaWaitingForConsensus) : undefined,
      // Żywi współmafiosi (z sobą) — pozwala pokazać „jeszcze nie zagłosował”.
      mafiaTeammates: isMafiaNight || isMafiaDayVote
        ? Object.entries(state.roles ?? {})
            .filter(
              ([id, r]) =>
                r === 'mafia' &&
                state.players.has(id) &&
                !state.eliminatedBots?.has(id),
            )
            .map(([id]) => id)
        : undefined,
    };
  }

  socket.on('get_game_state', async (_, callback) => {
    const state = rooms.get(socket.roomId);
    if (!state) return callback?.({ ok: false, error: 'no_room' });

    // Niezależne zapytania do PB równolegle — wynik (werdykt) ma dotrzeć do gracza
    // jak najszybciej po wybudzeniu telefonu. night_actions tylko tego gracza.
    const [players, rounds, myActions] = await Promise.all([
      pb.collection('room_players').getFullList({
        filter: `room_id = "${state.id}"`,
        expand: 'user_id',
        requestKey: null,
      }),
      pb.collection('rounds').getFullList({
        filter: `room_id = "${state.id}"`,
        sort: 'round_number',
        requestKey: null,
      }),
      pb
        .collection('night_actions')
        .getFullList({ filter: `actor_id = "${socket.userId}"`, requestKey: null })
        .catch((err) => {
          console.error('[game] get_game_state night_actions failed:', err.message);
          return [];
        }),
    ]);

    if (state.status === 'in_progress' && !state.phase && rounds.length > 0) {
      const lastRound = rounds[rounds.length - 1];
      state.phase = lastRound.phase || null;
      state.round = lastRound.round_number || 1;
      state.currentRoundId = lastRound.id;
      console.log(`[game] odtworzono fazę z PB: ${state.phase} (runda ${state.round})`);
    }

    const roundIds = new Set(rounds.map((r) => r.id));
    const allActions = myActions;
    const detectiveHistory = allActions
      .filter(
        (a) =>
          roundIds.has(a.round_id) &&
          a.actor_id === socket.userId &&
          a.action_type === 'investigate',
      )
      .map((a) => ({ targetId: a.target_id, result: a.result }));
    for (const h of state.detectiveLog?.get(socket.userId) ?? []) {
      const i = detectiveHistory.findIndex((d) => d.targetId === h.targetId);
      if (i === -1) detectiveHistory.push(h);
      else if (detectiveHistory[i].result?.is_mafia === undefined) detectiveHistory[i] = h;
    }

    const doctorHistory = allActions
      .filter(
        (a) =>
          roundIds.has(a.round_id) &&
          a.actor_id === socket.userId &&
          a.action_type === 'protect',
      )
      .map((a) => ({ targetId: a.target_id, roundId: a.round_id }));

    const isMaster = socket.userId === state.hostId;
    const isFinished = state.status === 'finished';
    // Po zakończeniu gry role są ujawnione wszystkim, nie tylko masterowi.
    const canSeeRoles = isMaster || isFinished;

    const pbPlayerIds = new Set(players.map((p) => p.user_id));
    const allPlayers = [
      ...players.map((p) => {
        const userExp = p.expand?.user_id;
        const avatarFile = userExp?.avatar;
        const avatarUrl =
          avatarFile && typeof avatarFile === 'string'
            ? `/api/files/users/${userExp.id}/${avatarFile}`
            : null;
        return {
          id: p.user_id,
          username: state.players.get(p.user_id)?.username || p.user_id,
          isMaster: p.is_master,
          isBot: false,
          eliminated: !!p.eliminated_at,
          seatOrder: p.seat_order,
          avatarUrl,
          role: canSeeRoles ? state.roles?.[p.user_id] || p.role : undefined,
        };
      }),
      ...Array.from(state.players.entries())
        .filter(([id, info]) => info.isBot && !pbPlayerIds.has(id))
        .map(([id, info]) => ({
          id,
          username: info.username,
          isMaster: false,
          isBot: true,
          eliminated: Boolean(state.eliminatedBots?.has(id)),
          seatOrder: 999,
          avatarUrl: null,
          role: canSeeRoles ? state.roles?.[id] : undefined,
        })),
    ];

    callback?.({
      ok: true,
      phase: state.phase,
      round: state.round,
      status: state.status,
      winner: isFinished ? state.winner ?? null : undefined,
      // Podsumowanie (przebieg rund, szanse) — po końcu gry jawne dla wszystkich.
      summary: isFinished ? state.gameSummary ?? null : undefined,
      role: state.roles?.[socket.userId] || null,
      isMaster,
      settings: state.settings,
      your_action_history: { detective: detectiveHistory, doctor: doctorHistory },
      lastDoctorTarget: state.previousDoctorTargets
        ? state.previousDoctorTargets[socket.userId] ?? null
        : state.previousDoctorProtectTarget ?? null,
      // Wielu lekarzy/detektywów: bieżąca tura i moja kolejka (bez ujawniania innych graczy).
      turn: state.nightTurn ?? 0,
      myTurnIndex: turnIndexOf(state, socket.userId),
      turnCount: isMaster ? turnCount(state, state.phase) : undefined,
      players: allPlayers,
      // Master: kto już zagłosował w bieżącym głosowaniu (odtwarza karty po odświeżeniu).
      votedPlayerIds:
        isMaster && state.phase === 'day_vote' ? [...(state.votes?.keys() ?? [])] : undefined,
      // Mafia wie, którzy współmafiosi odpadli z gry (tylko dla mafii).
      mafiaFallen:
        state.roles?.[socket.userId] === 'mafia'
          ? allPlayers
              .filter((p) => p.eliminated && state.roles?.[p.id] === 'mafia')
              .map((p) => p.id)
          : undefined,
      roles: canSeeRoles ? state.roles : undefined,
      // Wynik bieżącej fazy rozstrzygnięcia — pozwala odtworzyć ekran werdyktu
      // po obudzeniu telefonu / odświeżeniu strony, zanim master przejdzie dalej.
      phaseResult: state.phaseResult ?? null,
      // Werdykt ostatniej nocy przeżywa fazę dyskusji — pozwala odtworzyć
      // nakładkę z wynikiem nocy po odświeżeniu strony w day_deliberation.
      lastNightResult: state.lastNightResult ?? null,
      // Czy TEN gracz złożył już akcję/głos w bieżącej nocy/rundzie. Klient po wybudzeniu
      // telefonu nie dostał `phase_changed` (które zeruje te flagi), więc bez tego
      // trzymał „Akcja złożona” z poprzedniej nocy i blokował wybór celu.
      ...submissionStatus(state, socket.userId),
      ...(() => {
        const st = submissionStatus(state, socket.userId);
        if (!Array.isArray(st.mafiaTeammates)) return {};
        const dead = new Set(allPlayers.filter((p) => p.eliminated).map((p) => p.id));
        return { mafiaTeammates: st.mafiaTeammates.filter((id) => !dead.has(id)) };
      })(),
      // Karty mocy (tryb zaawansowany) — tylko własne karty, dziennik i prompt tury.
      ...(() => {
        if (state.settings?.advanced_mode !== true) return {};
        ensureCardState(state);
        const role = state.roles?.[socket.userId];
        // Lista celów dla tury karty — serwer zna role, więc podaje tylko dozwolone wybory.
        let cardPrompt = cardPromptFor(state, socket.userId);
        if (cardPrompt) {
          const aliveIds = allPlayers.filter((p) => !p.eliminated && !p.isMaster).map((p) => p.id);
          const roleOf = (id) => state.roles?.[id];
          const candidates =
            cardPrompt.type === 'check'
              ? aliveIds.filter((id) => id !== socket.userId)
              : cardPrompt.type === 'alibi'
              ? aliveIds.filter((id) => roleOf(id) === 'mafia')
              : cardPrompt.type === 'false_lead'
              ? aliveIds.filter((id) => roleOf(id) !== 'mafia')
              : [];
          cardPrompt = {
            ...cardPrompt,
            candidates,
            ...(cardPrompt.type === 'check' ? { targetCount: Math.min(3, candidates.length) } : {}),
          };
        }
        return {
          cards: cardsFor(state, socket.userId),
          cardLog: state.cardLog[socket.userId] || [],
          cardPrompt,
          mafiaCard: role === 'mafia' ? mafiaCardInfo(state) : undefined,
          cardQueue: isMaster ? cardQueueFor(state) : undefined,
          cardsOverview: isMaster ? cardsOverview(state) : undefined,
        };
      })(),
      // Historia „Podglądu live” — tylko dla mastera (zawiera role i akcje nocne).
      insightLog: isMaster ? state.insightLog ?? [] : undefined,
      ...phaseMeta(state),
    });
  });
}
