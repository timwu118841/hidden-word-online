import { roundMultiplierFor, type RuleConfig } from "./config";
import type { Hint } from "./types";

/**
 * Pick the hint shown to everyone for a stage: highest score wins; ties go to the
 * earliest submission, and a full tie keeps the earlier position in `hints`.
 * Only `scored` hints are eligible — rejected / failed / dropped / pending never are.
 */
export function selectRevealedHint(hints: readonly Hint[]): Hint | null {
  let best: Hint | null = null;
  for (const hint of hints) {
    if (hint.status !== "scored" || hint.score === null) continue;
    if (best === null) {
      best = hint;
      continue;
    }
    const bestScore = best.score as number;
    if (hint.score > bestScore) {
      best = hint;
    } else if (hint.score === bestScore && hint.submittedAt < best.submittedAt) {
      best = hint;
    }
  }
  return best;
}

/** Setter points for a stage with no correct guess, already multiplied for the round. */
export function setterPointsFor(rules: RuleConfig, stageIndex: number, round: number): number {
  const base = rules.setterStagePoints[stageIndex] ?? 0;
  return base * roundMultiplierFor(rules, round);
}

/** Points a correct guesser earns in a round. */
export function guesserPointsFor(rules: RuleConfig, round: number): number {
  return rules.guesserPoints * roundMultiplierFor(rules, round);
}
