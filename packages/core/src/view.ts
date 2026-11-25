import type {
  FinalView,
  GameState,
  HintView,
  Player,
  PlayerId,
  PlayerView,
  PlayerPublic,
  Stage,
  StageView,
  Turn,
  TurnSummary,
  TurnView,
} from "./types";

/**
 * Allow-list projection of the authoritative state for one player.
 *
 * Every object is rebuilt from scratch; the state is never spread into a view, so
 * adding a secret field to `GameState` cannot leak it here by accident.
 */
export function viewFor(state: GameState, playerId: PlayerId): PlayerView {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) throw new Error(`viewFor: unknown player ${playerId}`);

  return {
    roomCode: state.roomCode,
    mode: state.mode,
    rules: state.rules,
    phase: state.phase,
    phaseSeq: state.phaseSeq,
    deadline: state.deadline,
    serverNow: 0,
    me: {
      id: me.id,
      isHost: me.id === state.hostId,
      envelope: [...me.envelope],
      hiddenWord: me.hiddenWord,
      pieces: me.pieces,
    },
    players: state.players.map((player) => publicPlayer(player, state.hostId)),
    round: state.round,
    totalRounds: state.rules.rounds,
    turnIndex: state.turnIndex,
    turnCount: state.turnOrder.length,
    turn: state.turn ? buildTurn(state, state.turn, me) : null,
    history: buildHistory(state.history),
    final: state.phase === "final" ? buildFinal(state) : null,
  };
}

function publicPlayer(player: Player, hostId: PlayerId): PlayerPublic {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    isHost: player.id === hostId,
    ready: player.ready,
    connected: player.connected,
    away: player.away,
    score: player.score,
    pieces: player.pieces,
    hasPicked: player.hiddenWord !== null,
  };
}

function buildTurn(state: GameState, turn: Turn, me: Player): TurnView {
  const isSetter = turn.setterId === me.id;
  const setter = state.players.find((p) => p.id === turn.setterId);
  const hiddenWord = isSetter
    ? me.hiddenWord
    : turn.outcome !== null
      ? (setter?.hiddenWord ?? null)
      : null;

  return {
    round: turn.round,
    setterId: turn.setterId,
    stages: turn.stages.map((stage) => buildStage(stage, me, isSetter)),
    usedPieceThisTurn: turn.piecesUsed.includes(me.id),
    hiddenWord,
    outcome: turn.outcome,
  };
}

function buildStage(stage: Stage, me: Player, isSetter: boolean): StageView {
  const revealedHint = stage.revealedHintId
    ? (stage.hints.find((h) => h.id === stage.revealedHintId) ?? null)
    : null;

  const hints: HintView[] = [];
  for (const hint of stage.hints) {
    // Non-setters only learn that a hint existed once it is pending or scored.
    if (!isSetter && hint.status !== "pending" && hint.status !== "scored") continue;
    const isRevealed = revealedHint !== null && revealedHint.id === hint.id;
    hints.push({
      id: hint.id,
      status: hint.status,
      score: hint.score,
      word: isSetter || isRevealed ? hint.word : null,
      reason: isSetter ? hint.reason : null,
    });
  }

  const mine = stage.guesses[me.id];
  return {
    index: stage.index,
    hints,
    revealed: revealedHint
      ? { word: revealedHint.word, score: revealedHint.score ?? 0 }
      : null,
    myGuess: mine ? [...mine.words] : null,
    guesses: stage.resolved
      ? Object.values(stage.guesses).map((guess) => ({
          playerId: guess.playerId,
          words: [...guess.words],
          correct: guess.correct,
        }))
      : null,
    submittedIds: Object.keys(stage.guesses),
    setterGain: stage.setterGain,
    guesserGains: Object.fromEntries(Object.entries(stage.guesserGains)),
    resolved: stage.resolved,
  };
}

function buildHistory(history: TurnSummary[]): TurnSummary[] {
  return history.map((entry) => ({
    round: entry.round,
    setterId: entry.setterId,
    hiddenWord: entry.hiddenWord,
    revealed: entry.revealed.map((reveal) => ({
      stage: reveal.stage,
      word: reveal.word,
      score: reveal.score,
    })),
    outcome: entry.outcome,
    correctGuessers: [...entry.correctGuessers],
    setterPoints: entry.setterPoints,
  }));
}

function buildFinal(state: GameState): FinalView {
  const sorted = [...state.players].sort((a, b) => b.score - a.score || a.seat - b.seat);
  const ranking: FinalView["ranking"] = [];
  let rank = 1;
  sorted.forEach((player, index) => {
    const previous = sorted[index - 1];
    if (!previous || previous.score !== player.score) rank = index + 1;
    ranking.push({ playerId: player.id, rank, score: player.score });
  });

  const hiddenWords: Record<PlayerId, string | null> = {};
  for (const player of state.players) hiddenWords[player.id] = player.hiddenWord;

  return {
    ranking,
    endReason: state.endReason ?? "completed",
    hiddenWords,
  };
}
