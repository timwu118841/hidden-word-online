import { MODE_PRESETS, type GameMode } from "./config";
import { isValidWordFormat, normalizeWord } from "./normalize";
import { guesserPointsFor, selectRevealedHint, setterPointsFor } from "./scoring";
import type {
  Effect,
  EndReason,
  ErrorCode,
  GameEvent,
  GameState,
  Hint,
  HintRejectReason,
  Player,
  PlayerId,
  ReduceResult,
  Stage,
  Turn,
  TurnOutcome,
} from "./types";

/* ------------------------------------------------------------------ */
/* Creation                                                            */
/* ------------------------------------------------------------------ */

export function createGame(
  roomCode: string,
  mode: GameMode,
  host: { id: PlayerId; name: string },
  _now: number,
): GameState {
  const rules = structuredClone(MODE_PRESETS[mode]);
  return {
    roomCode,
    mode,
    rules,
    phase: "lobby",
    phaseSeq: 1,
    deadline: null,
    players: [makePlayer(host.id, host.name, 0, rules.startingPieces)],
    hostId: host.id,
    round: 0,
    envelopes: {},
    turnOrder: [],
    turnIndex: 0,
    turn: null,
    history: [],
    endReason: null,
    nextHintSeq: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

export function reduce(state: GameState, event: GameEvent, now: number): ReduceResult {
  const s = structuredClone(state);
  const effects: Effect[] = [];

  /** Invalid intent: the caller's state is untouched. */
  const fail = (error: ErrorCode): ReduceResult => ({ state, effects: [], error });
  /** Ignored / stale event: still an unchanged state, just not the caller's object. */
  const noop = (): ReduceResult => ({ state, effects: [] });
  const done = (): ReduceResult => ({ state: s, effects });

  switch (event.type) {
    /* ---------------- lobby ---------------- */

    case "JOIN": {
      if (s.phase !== "lobby") return fail("game_started");
      if (s.players.length >= s.rules.maxPlayers) return fail("room_full");
      if (findPlayer(s, event.playerId)) return fail("bad_request");
      s.players.push(
        makePlayer(event.playerId, event.name.trim(), s.players.length, s.rules.startingPieces),
      );
      if (s.hostId === "") s.hostId = event.playerId;
      return done();
    }

    case "LEAVE": {
      const player = findPlayer(s, event.playerId);
      if (!player) return fail("unknown_player");
      if (s.phase === "lobby") {
        removePlayer(s, player.id);
        return done();
      }
      player.connected = false;
      if (s.phase === "final") {
        player.away = true;
        return done();
      }
      if (player.away) return done();
      applyAway(s, player, effects, now);
      return done();
    }

    case "SET_READY": {
      if (s.phase !== "lobby") return fail("wrong_phase");
      const player = findPlayer(s, event.playerId);
      if (!player) return fail("unknown_player");
      player.ready = event.ready;
      return done();
    }

    case "KICK": {
      if (event.by !== s.hostId) return fail("not_host");
      if (s.phase !== "lobby") return fail("wrong_phase");
      const target = findPlayer(s, event.target);
      if (!target) return fail("unknown_player");
      if (target.id === event.by) return fail("bad_request");
      removePlayer(s, target.id);
      return done();
    }

    case "START": {
      if (event.by !== s.hostId) return fail("not_host");
      if (s.phase !== "lobby") return fail("wrong_phase");
      if (s.players.length < s.rules.minPlayers) return fail("not_enough_players");
      if (!s.players.every((p) => p.ready)) return fail("not_all_ready");
      s.envelopes = structuredClone(event.envelopes);
      s.round = 0;
      beginRound(s, effects, now);
      return done();
    }

    /* ---------------- picking ---------------- */

    case "PICK_WORD": {
      if (s.phase !== "pick") return fail("wrong_phase");
      const player = findPlayer(s, event.playerId);
      if (!player) return fail("unknown_player");
      if (player.hiddenWord !== null) return fail("already_picked");
      const word = normalizeWord(event.word);
      if (!player.envelope.includes(word)) return fail("not_in_envelope");
      player.hiddenWord = word;
      if (allActivePicked(s)) {
        fillAwayUnpicked(s);
        startTurn(s, effects, now);
      }
      return done();
    }

    /* ---------------- hint phase ---------------- */

    case "SUBMIT_HINT": {
      if (s.phase !== "hint" || !s.turn) return fail("wrong_phase");
      if (s.turn.setterId !== event.playerId) return fail("not_your_turn");
      const setter = findPlayer(s, event.playerId);
      if (!setter) return fail("unknown_player");
      const stage = currentStage(s);
      if (!stage) return fail("wrong_phase");
      if (stage.hints.some((h) => h.status === "pending")) return fail("hint_pending");
      if (usedHintSlots(stage) >= s.rules.maxHintsPerStage) return fail("hint_cap");

      const id = `h${s.nextHintSeq}`;
      s.nextHintSeq += 1;
      const word = normalizeWord(event.word);
      const hidden = setter.hiddenWord ?? "";

      const reject = (reason: HintRejectReason): ReduceResult => {
        stage.hints.push({
          id,
          word,
          status: "rejected",
          score: null,
          reason,
          submittedAt: now,
        });
        return done();
      };

      if (!isValidWordFormat(word, s.rules.maxWordLength)) return reject("format");
      if (hidden !== "" && (word === hidden || hidden.includes(word) || word.includes(hidden))) {
        return reject("contains_hidden");
      }
      const alreadyUsed = s.turn.stages.some((st) =>
        st.hints.some(
          (h) => (h.status === "pending" || h.status === "scored") && h.word === word,
        ),
      );
      if (alreadyUsed) return reject("duplicate");

      stage.hints.push({ id, word, status: "pending", score: null, reason: null, submittedAt: now });
      effects.push({ type: "scoreHint", hintId: id, hidden, hint: word });
      if (usedHintSlots(stage) >= s.rules.maxHintsPerStage) stage.stopRequested = true;
      return done();
    }

    case "HINT_SCORED": {
      const stage = liveHintStage(s);
      if (!stage) return noop();
      const hint = stage.hints.find((h) => h.id === event.hintId && h.status === "pending");
      if (!hint) return noop();

      if (!event.isNoun) {
        hint.status = "rejected";
        hint.reason = "not_noun";
        hint.score = event.score;
        if (stage.stopRequested) endHintPhase(s, effects, now);
        return done();
      }

      hint.status = "scored";
      hint.score = event.score;
      if (event.score >= s.rules.instantRevealThreshold) {
        endHintPhase(s, effects, now);
      } else if (
        stage.stopRequested ||
        stage.hints.filter((hint) => hint.status === "scored").length >= s.rules.maxHintsPerStage
      ) {
        endHintPhase(s, effects, now);
      }
      return done();
    }

    case "HINT_FAILED": {
      const stage = liveHintStage(s);
      if (!stage) return noop();
      const hint = stage.hints.find((h) => h.id === event.hintId && h.status === "pending");
      if (!hint) return noop();
      hint.status = "failed";
      hint.reason = event.reason;
      hint.score = null;
      if (stage.stopRequested) endHintPhase(s, effects, now);
      return done();
    }

    case "STOP_HINTS": {
      if (s.phase !== "hint" || !s.turn) return fail("wrong_phase");
      if (s.turn.setterId !== event.playerId) return fail("not_your_turn");
      const stage = currentStage(s);
      if (!stage) return fail("wrong_phase");
      if (stage.hints.some((h) => h.status === "pending")) {
        stage.stopRequested = true;
      } else {
        endHintPhase(s, effects, now);
      }
      return done();
    }

    /* ---------------- guess phase ---------------- */

    case "SUBMIT_GUESS": {
      if (s.phase !== "guess" || !s.turn) return fail("wrong_phase");
      const player = findPlayer(s, event.playerId);
      if (!player) return fail("unknown_player");
      if (s.turn.setterId === event.playerId) return fail("not_your_turn");
      if (player.away) return fail("wrong_phase");
      if (event.words.length > 2) return fail("bad_request");
      const stage = currentStage(s);
      if (!stage) return fail("wrong_phase");
      if (stage.guesses[player.id]) return fail("already_guessed");

      const words = event.words.map(normalizeWord).filter((w) => w.length > 0);
      if (words.length === 2) {
        if (s.turn.piecesUsed.includes(player.id)) return fail("piece_used");
        if (player.pieces <= 0) return fail("no_piece");
        player.pieces -= 1;
        s.turn.piecesUsed.push(player.id);
      }

      const hidden = findPlayer(s, s.turn.setterId)?.hiddenWord ?? "";
      stage.guesses[player.id] = {
        playerId: player.id,
        words,
        correct: hidden !== "" && words.some((w) => w === hidden),
      };
      if (allActiveGuessersSubmitted(s)) resolveStage(s, effects, now);
      return done();
    }

    /* ---------------- timeouts ---------------- */

    case "TIMEOUT": {
      if (event.phaseSeq !== s.phaseSeq) return noop();
      switch (s.phase) {
        case "pick":
          autoPick(s, event.rand);
          startTurn(s, effects, now);
          break;
        case "hint":
          endHintPhase(s, effects, now);
          break;
        case "guess":
          resolveStage(s, effects, now);
          break;
        case "result":
          advanceAfterResult(s, effects, now);
          break;
        default:
          return noop();
      }
      return done();
    }

    /* ---------------- presence ---------------- */

    case "CONNECT": {
      const player = findPlayer(s, event.playerId);
      if (!player) return fail("unknown_player");
      player.connected = true;
      player.away = false;
      player.connSeq += 1;
      return done();
    }

    case "DISCONNECT": {
      const player = findPlayer(s, event.playerId);
      if (!player) return fail("unknown_player");
      player.connected = false;
      effects.push({
        type: "setAwayTimer",
        playerId: player.id,
        connSeq: player.connSeq,
        deadline: now + s.rules.disconnectGraceMs,
      });
      return done();
    }

    case "AWAY_TIMEOUT": {
      const player = findPlayer(s, event.playerId);
      if (!player) return noop();
      if (player.away || player.connected || player.connSeq !== event.connSeq) return noop();
      applyAway(s, player, effects, now);
      return done();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Construction helpers                                                */
/* ------------------------------------------------------------------ */

function makePlayer(id: PlayerId, name: string, seat: number, pieces: number): Player {
  return {
    id,
    name,
    seat,
    ready: false,
    connected: true,
    away: false,
    connSeq: 1,
    score: 0,
    pieces,
    envelope: [],
    hiddenWord: null,
  };
}

function findPlayer(s: GameState, id: PlayerId): Player | undefined {
  return s.players.find((p) => p.id === id);
}

function removePlayer(s: GameState, id: PlayerId): void {
  s.players = s.players.filter((p) => p.id !== id);
  s.players.forEach((p, index) => {
    p.seat = index;
  });
  if (s.hostId === id) s.hostId = s.players[0]?.id ?? "";
}

/* ------------------------------------------------------------------ */
/* Phase / turn machinery                                              */
/* ------------------------------------------------------------------ */

function setPhase(
  s: GameState,
  phase: GameState["phase"],
  deadline: number,
  effects: Effect[],
): void {
  s.phase = phase;
  s.phaseSeq += 1;
  s.deadline = deadline;
  effects.push({ type: "setTimer", phaseSeq: s.phaseSeq, deadline });
}

function beginRound(s: GameState, effects: Effect[], now: number): void {
  for (const player of s.players) {
    player.envelope = [...(s.envelopes[player.id]?.[s.round] ?? [])];
    player.hiddenWord = null;
  }
  s.turnOrder = s.players.map((p) => p.id);
  s.turnIndex = 0;
  s.turn = null;
  setPhase(s, "pick", now + s.rules.timers.pickMs, effects);
}

function startTurn(s: GameState, effects: Effect[], now: number): void {
  while (s.turnIndex < s.turnOrder.length) {
    const setterId = s.turnOrder[s.turnIndex];
    const setter = setterId === undefined ? undefined : findPlayer(s, setterId);
    if (setter && !setter.away) {
      s.turn = {
        round: s.round,
        setterId: setter.id,
        stages: [],
        piecesUsed: [],
        outcome: null,
      };
      pushStage(s, 0, effects, now);
      return;
    }
    s.turnIndex += 1;
  }
  endRound(s, effects, now);
}

function pushStage(s: GameState, index: number, effects: Effect[], now: number): void {
  const turn = s.turn;
  if (!turn) return;
  turn.stages.push({
    index,
    hints: [],
    stopRequested: false,
    revealedHintId: null,
    guesses: {},
    setterGain: 0,
    guesserGains: {},
    resolved: false,
  });
  setPhase(s, "hint", now + s.rules.timers.hintMs, effects);
}

function endRound(s: GameState, effects: Effect[], now: number): void {
  s.turnIndex = s.turnOrder.length;
  s.turn = null;
  if (s.round + 1 < s.rules.rounds) {
    s.round += 1;
    beginRound(s, effects, now);
    return;
  }
  endGame(s, "completed", effects);
}

function endGame(s: GameState, reason: EndReason, effects: Effect[]): void {
  s.phase = "final";
  s.phaseSeq += 1;
  s.deadline = null;
  s.endReason = reason;
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    if (effects[i]?.type === "setTimer") effects.splice(i, 1);
  }
  effects.push({ type: "clearTimer" }, { type: "gameOver" });
}

/* ------------------------------------------------------------------ */
/* Stage machinery                                                     */
/* ------------------------------------------------------------------ */

function currentStage(s: GameState): Stage | null {
  const turn = s.turn;
  if (!turn || turn.stages.length === 0) return null;
  return turn.stages[turn.stages.length - 1] ?? null;
}

/** The current stage, but only while the reducer may still apply hint events to it. */
function liveHintStage(s: GameState): Stage | null {
  if (s.phase !== "hint" || !s.turn) return null;
  return currentStage(s);
}

function usedHintSlots(stage: Stage): number {
  return stage.hints.filter((h) => h.status === "pending" || h.status === "scored").length;
}

function endHintPhase(s: GameState, effects: Effect[], now: number): void {
  const turn = s.turn;
  const stage = currentStage(s);
  if (!turn || !stage || stage.resolved) return;
  for (const hint of stage.hints) {
    if (hint.status === "pending") hint.status = "dropped";
  }
  const revealed = selectRevealedHint(stage.hints);
  if (!revealed) {
    resolveStage(s, effects, now);
    return;
  }
  stage.revealedHintId = revealed.id;
  if (activeGuessers(s, turn.setterId).length === 0) {
    resolveStage(s, effects, now);
    return;
  }
  setPhase(s, "guess", now + s.rules.timers.guessMs, effects);
}

function resolveStage(s: GameState, effects: Effect[], now: number): void {
  const turn = s.turn;
  const stage = currentStage(s);
  if (!turn || !stage || stage.resolved) return;

  const correctGuessers = Object.values(stage.guesses)
    .filter((g) => g.correct)
    .map((g) => g.playerId);

  if (correctGuessers.length > 0) {
    const points = guesserPointsFor(s.rules, s.round);
    for (const id of correctGuessers) {
      const player = findPlayer(s, id);
      if (player) player.score += points;
      stage.guesserGains[id] = points;
    }
    turn.outcome = "guessed";
  } else {
    const revealed = stage.revealedHintId
      ? stage.hints.find((h) => h.id === stage.revealedHintId)
      : undefined;
    if (
      revealed &&
      revealed.score !== null &&
      revealed.score >= s.rules.minRevealScoreForSetter
    ) {
      const points = setterPointsFor(s.rules, stage.index, s.round);
      const setter = findPlayer(s, turn.setterId);
      if (setter) setter.score += points;
      stage.setterGain = points;
    }
    if (stage.index >= s.rules.stagesPerTurn - 1) turn.outcome = "exhausted";
  }

  stage.resolved = true;
  setPhase(s, "result", now + s.rules.timers.resultMs, effects);
  if (turn.outcome !== null) pushSummary(s, turn);
}

function advanceAfterResult(s: GameState, effects: Effect[], now: number): void {
  const turn = s.turn;
  if (!turn) {
    endRound(s, effects, now);
    return;
  }
  if (turn.outcome === null) {
    const stage = currentStage(s);
    pushStage(s, (stage?.index ?? -1) + 1, effects, now);
    return;
  }
  s.turnIndex += 1;
  startTurn(s, effects, now);
}

function pushSummary(s: GameState, turn: Turn): void {
  const setter = findPlayer(s, turn.setterId);
  const revealed: Array<{ stage: number; word: string; score: number }> = [];
  for (const stage of turn.stages) {
    if (!stage.revealedHintId) continue;
    const hint = stage.hints.find((h) => h.id === stage.revealedHintId);
    if (!hint) continue;
    revealed.push({ stage: stage.index, word: hint.word, score: hint.score ?? 0 });
  }
  const correctGuessers: PlayerId[] = [];
  for (const stage of turn.stages) {
    for (const guess of Object.values(stage.guesses)) {
      if (guess.correct) correctGuessers.push(guess.playerId);
    }
  }
  s.history.push({
    round: turn.round,
    setterId: turn.setterId,
    hiddenWord: setter?.hiddenWord ?? "",
    revealed,
    outcome: turn.outcome as TurnOutcome,
    correctGuessers,
    setterPoints: turn.stages.reduce((sum, stage) => sum + stage.setterGain, 0),
  });
}

/* ------------------------------------------------------------------ */
/* Actors and pick helpers                                             */
/* ------------------------------------------------------------------ */

function activeGuessers(s: GameState, setterId: PlayerId): Player[] {
  return s.players.filter((p) => !p.away && p.id !== setterId);
}

function allActiveGuessersSubmitted(s: GameState): boolean {
  const turn = s.turn;
  const stage = currentStage(s);
  if (!turn || !stage) return false;
  return activeGuessers(s, turn.setterId).every((p) => stage.guesses[p.id] !== undefined);
}

function allActivePicked(s: GameState): boolean {
  return s.players.every((p) => p.away || p.hiddenWord !== null);
}

function fillAwayUnpicked(s: GameState): void {
  for (const player of s.players) {
    if (!player.away || player.hiddenWord !== null) continue;
    const word = player.envelope[0];
    if (word !== undefined) player.hiddenWord = word;
  }
}

function autoPick(s: GameState, rand: number): void {
  const r = Number.isFinite(rand) ? Math.min(Math.max(rand, 0), 0.999_999) : 0;
  for (const player of s.players) {
    if (player.hiddenWord !== null) continue;
    const envelope = player.envelope;
    if (envelope.length === 0) continue;
    const index = Math.min(envelope.length - 1, Math.floor(r * envelope.length));
    player.hiddenWord = envelope[index] ?? null;
  }
}

/* ------------------------------------------------------------------ */
/* Presence                                                            */
/* ------------------------------------------------------------------ */

/** Caller has already flipped `connected` to false. */
function applyAway(s: GameState, player: Player, effects: Effect[], now: number): void {
  if (s.phase === "lobby") {
    removePlayer(s, player.id);
    return;
  }
  player.away = true;

  if (s.phase !== "final") {
    const turn = s.turn;
    const setterAwayMidTurn =
      turn !== null &&
      turn.outcome === null &&
      turn.setterId === player.id &&
      (s.phase === "hint" || s.phase === "guess" || s.phase === "result");

    if (setterAwayMidTurn) {
      const stage = currentStage(s);
      if (stage) {
        for (const hint of stage.hints) {
          if (hint.status === "pending") hint.status = "dropped";
        }
        stage.resolved = true;
      }
      turn.outcome = "setter_away";
      setPhase(s, "result", now + s.rules.timers.resultMs, effects);
      pushSummary(s, turn);
    } else if (s.phase === "pick") {
      if (allActivePicked(s)) {
        fillAwayUnpicked(s);
        startTurn(s, effects, now);
      }
    } else if (s.phase === "guess") {
      if (allActiveGuessersSubmitted(s)) resolveStage(s, effects, now);
    }
  }

  if (s.phase !== "final" && s.players.filter((p) => !p.away).length < 2) {
    endGame(s, "not_enough_players", effects);
  }
}
