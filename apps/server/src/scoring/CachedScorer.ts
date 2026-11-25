import type { Db } from "../db/sqlite";
import type { ScoreResult, Scorer } from "./Scorer";
import { ScorerError } from "./Scorer";

export interface CachedScorerOptions {
  model: string;
  promptVersion: string;
  /** Maximum LLM calls per UTC day across the whole process. */
  dailyCallCap: number;
  now?: () => number;
}

interface PairRow {
  score: number;
}

interface NounRow {
  is_noun: number;
}

interface UsageRow {
  calls: number;
}

/**
 * Persistent two-level cache around another scorer.
 *
 * - pair scores: unordered pair + model + prompt version (first score wins);
 * - noun flags: hint word + model + prompt version (the flag belongs to the hint,
 *   not to the pair);
 * - in-flight requests are deduped so concurrent identical hints cost one call;
 * - a daily cap on LLM calls protects against cost spikes.
 */
export class CachedScorer implements Scorer {
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly dailyCallCap: number;
  private readonly now: () => number;

  private readonly inFlight = new Map<string, Promise<ScoreResult>>();

  private readonly readPairStmt: { get(key: string): PairRow | undefined };
  private readonly readNounStmt: { get(key: string): NounRow | undefined };
  private readonly insertPairStmt: {
    run(key: string, score: number, model: string, promptVersion: string, createdAt: number): unknown;
  };
  private readonly insertNounStmt: {
    run(key: string, word: string, isNoun: number, model: string, promptVersion: string): unknown;
  };
  private readonly readUsageStmt: { get(day: string): UsageRow | undefined };
  private readonly bumpUsageStmt: { run(day: string): unknown };

  constructor(
    private readonly db: Db,
    private readonly inner: Scorer,
    options: CachedScorerOptions,
  ) {
    this.model = options.model;
    this.promptVersion = options.promptVersion;
    this.dailyCallCap = options.dailyCallCap;
    this.now = options.now ?? Date.now;

    this.readPairStmt = db.prepare<[string], PairRow>("SELECT score FROM pair_scores WHERE key = ?");
    this.readNounStmt = db.prepare<[string], NounRow>("SELECT is_noun FROM word_pos WHERE key = ?");
    this.insertPairStmt = db.prepare(
      "INSERT OR IGNORE INTO pair_scores (key, score, model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    this.insertNounStmt = db.prepare(
      "INSERT OR IGNORE INTO word_pos (key, word, is_noun, model, prompt_version) VALUES (?, ?, ?, ?, ?)",
    );
    this.readUsageStmt = db.prepare<[string], UsageRow>("SELECT calls FROM llm_usage WHERE day = ?");
    this.bumpUsageStmt = db.prepare(
      "INSERT INTO llm_usage (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1",
    );
  }

  async score(hidden: string, hint: string): Promise<ScoreResult> {
    const pairKey = pairKeyOf(hidden, hint, this.model, this.promptVersion);
    const nounKey = nounKeyOf(hint, this.model, this.promptVersion);

    const cachedPair = this.readPairStmt.get(pairKey)?.score ?? null;
    const cachedNoun = toBooleanOrNull(this.readNounStmt.get(nounKey)?.is_noun);
    if (cachedPair !== null && cachedNoun !== null) {
      return { score: cachedPair, isNoun: cachedNoun };
    }

    // The sorted pair plus the hint identifies the work exactly; reversed pairs
    // with the same hint share one call.
    const flightKey = `${pairKey}\u0000${nounKey}`;
    const pending = this.inFlight.get(flightKey);
    if (pending !== undefined) return pending;

    const task = this.resolve(pairKey, nounKey, hidden, hint, cachedPair, cachedNoun);
    this.inFlight.set(flightKey, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  private async resolve(
    pairKey: string,
    nounKey: string,
    hidden: string,
    hint: string,
    cachedPair: number | null,
    cachedNoun: boolean | null,
  ): Promise<ScoreResult> {
    this.reserveCall();

    // Failures propagate and leave both caches untouched, so the next attempt retries.
    const judged = await this.inner.score(hidden, hint);

    this.insertPairStmt.run(pairKey, judged.score, this.model, this.promptVersion, this.now());
    this.insertNounStmt.run(nounKey, hint, judged.isNoun ? 1 : 0, this.model, this.promptVersion);

    // Read back so concurrent reversed pairs observe the first stored score/noun.
    const storedPair = this.readPairStmt.get(pairKey)?.score ?? judged.score;
    const storedNoun = toBooleanOrNull(this.readNounStmt.get(nounKey)?.is_noun) ?? judged.isNoun;

    return {
      score: cachedPair ?? storedPair,
      isNoun: cachedNoun ?? storedNoun,
    };
  }

  /**
   * Checks today's (UTC) counter and increments it. Synchronous better-sqlite3
   * statements cannot interleave, so check-then-increment is atomic here.
   */
  private reserveCall(): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const used = this.readUsageStmt.get(day)?.calls ?? 0;
    if (used >= this.dailyCallCap) {
      throw new ScorerError("quota", `daily LLM call cap reached (${this.dailyCallCap})`);
    }
    this.bumpUsageStmt.run(day);
  }
}

function pairKeyOf(a: string, b: string, model: string, promptVersion: string): string {
  const [first, second] = a <= b ? [a, b] : [b, a];
  return `${first}|${second}|${model}|${promptVersion}`;
}

function nounKeyOf(word: string, model: string, promptVersion: string): string {
  return `${word}|${model}|${promptVersion}`;
}

function toBooleanOrNull(value: number | undefined): boolean | null {
  if (value === undefined) return null;
  return value === 1;
}
