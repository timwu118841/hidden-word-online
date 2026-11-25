/**
 * Rule parameters for 隱藏詞 (The Devil's Plan S3 "Hidden Word").
 * Values marked [INFERENCE] were not recoverable from the show / fan clone and are tunable.
 */
export type GameMode = "quick" | "full";

export interface PhaseTimers {
  /** Envelope pick phase. [INFERENCE] */
  pickMs: number;
  /** One hint stage for the setter. [INFERENCE] */
  hintMs: number;
  /** Guess phase for non-setters. [INFERENCE] */
  guessMs: number;
  /** Result display before advancing. [INFERENCE] */
  resultMs: number;
}

export interface RuleConfig {
  minPlayers: number;
  maxPlayers: number;
  envelopeSize: number;
  rounds: number;
  /** Points multiplier per round index (0-based). */
  roundMultiplier: readonly number[];
  stagesPerTurn: number;
  /** [INFERENCE] */
  maxHintsPerStage: number;
  /** A scored hint at/above this ends the stage immediately and is revealed. */
  instantRevealThreshold: number;
  /** Setter earns stage points only when the revealed hint scored at least this. */
  minRevealScoreForSetter: number;
  /** Setter points per stage index (0-based) when nobody guesses correctly; cumulative across stages. */
  setterStagePoints: readonly number[];
  guesserPoints: number;
  /** [INFERENCE] */
  startingPieces: number;
  /** Max Han characters in a hint or answer. [INFERENCE] */
  maxWordLength: number;
  timers: PhaseTimers;
  disconnectGraceMs: number;
}

export const BASE_RULES: RuleConfig = {
  minPlayers: 2,
  maxPlayers: 7,
  envelopeSize: 5,
  rounds: 1,
  roundMultiplier: [1, 2],
  stagesPerTurn: 3,
  maxHintsPerStage: 5,
  instantRevealThreshold: 95,
  minRevealScoreForSetter: 60,
  setterStagePoints: [1, 2, 3],
  guesserPoints: 1,
  startingPieces: 1,
  maxWordLength: 6,
  timers: { pickMs: 60_000, hintMs: 120_000, guessMs: 45_000, resultMs: 8_000 },
  disconnectGraceMs: 60_000,
};

export const MODE_PRESETS: Record<GameMode, RuleConfig> = {
  quick: { ...BASE_RULES, rounds: 1 },
  full: { ...BASE_RULES, rounds: 2 },
};

/** Score bands for UI colouring. */
export const SCORE_BANDS = { top: 95, high: 80, mid: 60 } as const;

export type ScoreBand = "top" | "high" | "mid" | "low";

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_BANDS.top) return "top";
  if (score >= SCORE_BANDS.high) return "high";
  if (score >= SCORE_BANDS.mid) return "mid";
  return "low";
}

export function roundMultiplierFor(rules: RuleConfig, round: number): number {
  return rules.roundMultiplier[round] ?? rules.roundMultiplier[rules.roundMultiplier.length - 1] ?? 1;
}
