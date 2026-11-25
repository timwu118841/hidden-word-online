import type { GameMode, RuleConfig } from "./config";

export type PlayerId = string;

export type Phase = "lobby" | "pick" | "hint" | "guess" | "result" | "final";

/* ------------------------------------------------------------------ */
/* Server-only authoritative state (never sent to clients as-is)       */
/* ------------------------------------------------------------------ */

export interface Player {
  id: PlayerId;
  name: string;
  /** Seat order == turn order. */
  seat: number;
  ready: boolean;
  connected: boolean;
  away: boolean;
  /** Incremented on every CONNECT; guards stale AWAY_TIMEOUT events. */
  connSeq: number;
  score: number;
  pieces: number;
  /** Current round's envelope. */
  envelope: string[];
  /** Current round's hidden word (null until picked). */
  hiddenWord: string | null;
}

export type HintStatus = "pending" | "scored" | "rejected" | "failed" | "dropped";

export type HintRejectReason =
  | "format" // not 1..maxWordLength Han chars after normalization
  | "contains_hidden" // equals, contains, or is contained in the hidden word
  | "duplicate" // already used this turn
  | "not_noun" // scorer judged it not a noun
  | "scorer_error" // scorer failed / timed out
  | "quota"; // daily LLM cap reached

export interface Hint {
  id: string;
  /** Normalized hint word. */
  word: string;
  status: HintStatus;
  score: number | null;
  reason: HintRejectReason | null;
  submittedAt: number;
}

export interface Guess {
  playerId: PlayerId;
  /** Normalized answers; [] = pass. Length 2 means a Piece was spent. */
  words: string[];
  correct: boolean;
}

export interface Stage {
  /** 0-based. */
  index: number;
  hints: Hint[];
  /** Setter pressed stop (or cap reached) while a hint was pending; end when it resolves. */
  stopRequested: boolean;
  revealedHintId: string | null;
  guesses: Record<PlayerId, Guess>;
  setterGain: number;
  guesserGains: Record<PlayerId, number>;
  resolved: boolean;
}

export type TurnOutcome = "guessed" | "exhausted" | "setter_away";

export interface Turn {
  /** 0-based round index. */
  round: number;
  setterId: PlayerId;
  stages: Stage[];
  /** Players who spent a Piece this turn. */
  piecesUsed: PlayerId[];
  outcome: TurnOutcome | null;
}

export interface TurnSummary {
  round: number;
  setterId: PlayerId;
  hiddenWord: string;
  revealed: Array<{ stage: number; word: string; score: number }>;
  outcome: TurnOutcome;
  correctGuessers: PlayerId[];
  setterPoints: number;
}

export type EndReason = "completed" | "not_enough_players";

export interface GameState {
  roomCode: string;
  mode: GameMode;
  rules: RuleConfig;
  phase: Phase;
  /** Incremented on every phase change; stale TIMEOUTs carry an old value and are ignored. */
  phaseSeq: number;
  /** Epoch ms when the current phase times out; null when untimed (lobby/final). */
  deadline: number | null;
  /** Sorted by seat. */
  players: Player[];
  hostId: PlayerId;
  /** 0-based round index. */
  round: number;
  /** Envelopes for every round, drawn at START: envelopes[playerId][round] = words. */
  envelopes: Record<PlayerId, string[][]>;
  /** Setter order for the current round (seat order snapshot at round start). */
  turnOrder: PlayerId[];
  /** Index into turnOrder of the current setter. */
  turnIndex: number;
  turn: Turn | null;
  history: TurnSummary[];
  endReason: EndReason | null;
  /** Monotonic counter used to mint hint ids ("h1", "h2", ...). */
  nextHintSeq: number;
}

/* ------------------------------------------------------------------ */
/* Reducer I/O                                                         */
/* ------------------------------------------------------------------ */

export type GameEvent =
  | { type: "JOIN"; playerId: PlayerId; name: string }
  | { type: "LEAVE"; playerId: PlayerId }
  | { type: "SET_READY"; playerId: PlayerId; ready: boolean }
  | { type: "KICK"; by: PlayerId; target: PlayerId }
  /** envelopes[playerId][round] — drawn by the runtime, distinct across room and rounds. */
  | { type: "START"; by: PlayerId; envelopes: Record<PlayerId, string[][]> }
  | { type: "PICK_WORD"; playerId: PlayerId; word: string }
  | { type: "SUBMIT_HINT"; playerId: PlayerId; word: string }
  | { type: "HINT_SCORED"; hintId: string; score: number; isNoun: boolean }
  | { type: "HINT_FAILED"; hintId: string; reason: "scorer_error" | "quota" }
  | { type: "STOP_HINTS"; playerId: PlayerId }
  /** words: [] = pass; 2 words spends a Piece. */
  | { type: "SUBMIT_GUESS"; playerId: PlayerId; words: string[] }
  /** rand in [0,1): used for pick-timeout auto choice so the reducer stays pure. */
  | { type: "TIMEOUT"; phaseSeq: number; rand: number }
  | { type: "CONNECT"; playerId: PlayerId }
  | { type: "DISCONNECT"; playerId: PlayerId }
  | { type: "AWAY_TIMEOUT"; playerId: PlayerId; connSeq: number };

export type Effect =
  | { type: "scoreHint"; hintId: string; hidden: string; hint: string }
  /** Replace any existing phase timer. */
  | { type: "setTimer"; phaseSeq: number; deadline: number }
  | { type: "clearTimer" }
  | { type: "setAwayTimer"; playerId: PlayerId; connSeq: number; deadline: number }
  | { type: "gameOver" };

export type ErrorCode =
  | "bad_request"
  | "room_not_found"
  | "room_full"
  | "game_started"
  | "not_host"
  | "not_enough_players"
  | "not_all_ready"
  | "wrong_phase"
  | "not_your_turn"
  | "not_in_envelope"
  | "already_picked"
  | "hint_pending"
  | "hint_cap"
  | "already_guessed"
  | "no_piece"
  | "piece_used"
  | "unknown_player"
  | "rate_limited";

export interface ReduceResult {
  state: GameState;
  effects: Effect[];
  /** Set when the event was an invalid intent; state is unchanged in that case. */
  error?: ErrorCode;
}

/* ------------------------------------------------------------------ */
/* Client view (allow-listed, per player)                              */
/* ------------------------------------------------------------------ */

export interface HintView {
  id: string;
  status: HintStatus;
  score: number | null;
  /** Visible to the setter always; to others only when this hint was revealed. */
  word: string | null;
  /** Setter only. */
  reason: HintRejectReason | null;
}

export interface GuessView {
  playerId: PlayerId;
  words: string[];
  correct: boolean;
}

export interface StageView {
  index: number;
  hints: HintView[];
  revealed: { word: string; score: number } | null;
  /** This player's own submission for the stage (null if none yet). */
  myGuess: string[] | null;
  /** All guesses — only once the stage is resolved. */
  guesses: GuessView[] | null;
  /** Ids of players who have submitted (visible during guess phase, no contents). */
  submittedIds: PlayerId[];
  setterGain: number;
  guesserGains: Record<PlayerId, number>;
  resolved: boolean;
}

export interface TurnView {
  round: number;
  setterId: PlayerId;
  stages: StageView[];
  /** Whether *this* player already spent a Piece this turn. */
  usedPieceThisTurn: boolean;
  /** Setter's hidden word: setter always; others only after the turn ended. */
  hiddenWord: string | null;
  outcome: TurnOutcome | null;
}

export interface PlayerPublic {
  id: PlayerId;
  name: string;
  seat: number;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  away: boolean;
  score: number;
  pieces: number;
  hasPicked: boolean;
}

export interface FinalView {
  ranking: Array<{ playerId: PlayerId; rank: number; score: number }>;
  endReason: EndReason;
  /** Everyone's hidden words for the last played round. */
  hiddenWords: Record<PlayerId, string | null>;
}

export interface PlayerView {
  roomCode: string;
  mode: GameMode;
  rules: RuleConfig;
  phase: Phase;
  phaseSeq: number;
  deadline: number | null;
  /** Server clock at send time; client computes offset. Filled by the runtime. */
  serverNow: number;
  me: {
    id: PlayerId;
    isHost: boolean;
    envelope: string[];
    hiddenWord: string | null;
    pieces: number;
  };
  players: PlayerPublic[];
  round: number;
  totalRounds: number;
  turnIndex: number;
  turnCount: number;
  turn: TurnView | null;
  history: TurnSummary[];
  final: FinalView | null;
}
