/**
 * Relatedness scorer contract.
 *
 * A scorer judges how strongly a hint word relates to the setter's hidden word
 * (0 = unrelated, 100 = identical) and reports whether the hint is a noun.
 * Both inputs are already normalized 繁體中文 words.
 */
export interface ScoreResult {
  score: number;
  isNoun: boolean;
}

export interface Scorer {
  score(hidden: string, hint: string): Promise<ScoreResult>;
}

/**
 * Failure modes the room runtime maps onto `HINT_FAILED`:
 * - `scorer_error`: the model call failed or timed out (after the retry).
 * - `quota`: the daily LLM call cap has been reached.
 */
export class ScorerError extends Error {
  constructor(
    readonly reason: "scorer_error" | "quota",
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "ScorerError";
  }
}
