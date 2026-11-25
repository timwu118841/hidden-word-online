import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/sqlite";
import { CachedScorer } from "../src/scoring/CachedScorer";
import { DEFAULT_FAKE_TABLE, FakeScorer, fakePairKey } from "../src/scoring/FakeScorer";
import { ScorerError, type ScoreResult, type Scorer } from "../src/scoring/Scorer";
import { bandAccuracy, bandOf, confusionMatrix, spearman } from "../src/scoring/calibration";

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const BASE_OPTIONS = {
  model: "test-model",
  promptVersion: "test-v1",
  dailyCallCap: 100,
  now: () => NOW,
};

class CountingScorer implements Scorer {
  calls = 0;
  readonly pairs: Array<[string, string]> = [];
  private readonly produce: (hidden: string, hint: string, call: number) => ScoreResult | Promise<ScoreResult>;

  constructor(produce: (hidden: string, hint: string, call: number) => ScoreResult | Promise<ScoreResult> = () => ({
    score: 77,
    isNoun: true,
  })) {
    this.produce = produce;
  }

  async score(hidden: string, hint: string): Promise<ScoreResult> {
    this.calls += 1;
    this.pairs.push([hidden, hint]);
    return this.produce(hidden, hint, this.calls);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
}

// `Promise.withResolvers` is ES2024; the repo's lib target is ES2023 but Node 24 has it.
function deferred<T>(): Deferred<T> {
  const factory = Promise as unknown as { withResolvers<U>(): Deferred<U> };
  return factory.withResolvers<T>();
}

describe("CachedScorer", () => {
  it("returns the cached score on a repeated pair (one inner call)", async () => {
    const db = openDatabase(":memory:");
    try {
      const inner = new CountingScorer();
      const scorer = new CachedScorer(db, inner, BASE_OPTIONS);

      const first = await scorer.score("蘋果", "水果");
      const second = await scorer.score("蘋果", "水果");

      expect(first).toEqual({ score: 77, isNoun: true });
      expect(second).toEqual({ score: 77, isNoun: true });
      expect(inner.calls).toBe(1);
    } finally {
      db.close();
    }
  });

  it("reuses the pair score for a reversed pair but looks up the new hint's noun flag", async () => {
    const db = openDatabase(":memory:");
    try {
      const inner = new CountingScorer((_hidden, hint) =>
        hint === "蘋果" ? { score: 99, isNoun: false } : { score: 77, isNoun: true },
      );
      const scorer = new CachedScorer(db, inner, BASE_OPTIONS);

      expect(await scorer.score("蘋果", "水果")).toEqual({ score: 77, isNoun: true });

      // Same unordered pair (pair score cached) but "蘋果" has no noun flag yet.
      expect(await scorer.score("水果", "蘋果")).toEqual({ score: 77, isNoun: false });
      expect(inner.calls).toBe(2);

      // Both rows are now cached: no further inner call.
      expect(await scorer.score("水果", "蘋果")).toEqual({ score: 77, isNoun: false });
      expect(inner.calls).toBe(2);
    } finally {
      db.close();
    }
  });

  it("dedupes two concurrent identical requests into one inner call", async () => {
    const db = openDatabase(":memory:");
    try {
      const gate = deferred<ScoreResult>();
      const inner = new CountingScorer(() => gate.promise);
      const scorer = new CachedScorer(db, inner, BASE_OPTIONS);

      const first = scorer.score("貓", "狗");
      const second = scorer.score("貓", "狗");
      expect(inner.calls).toBe(1);

      gate.resolve({ score: 61, isNoun: true });
      expect(await Promise.all([first, second])).toEqual([
        { score: 61, isNoun: true },
        { score: 61, isNoun: true },
      ]);
      expect(inner.calls).toBe(1);
    } finally {
      db.close();
    }
  });

  it("keeps cached scores across a database reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hw-cache-"));
    const path = join(dir, "scores.db");
    try {
      const firstDb = openDatabase(path);
      const firstInner = new CountingScorer();
      const firstScorer = new CachedScorer(firstDb, firstInner, BASE_OPTIONS);
      expect(await firstScorer.score("學校", "教室")).toEqual({ score: 77, isNoun: true });
      expect(firstInner.calls).toBe(1);
      firstDb.close();

      const secondDb = openDatabase(path);
      try {
        const secondInner = new CountingScorer();
        const secondScorer = new CachedScorer(secondDb, secondInner, BASE_OPTIONS);
        expect(await secondScorer.score("學校", "教室")).toEqual({ score: 77, isNoun: true });
        expect(secondInner.calls).toBe(0);
      } finally {
        secondDb.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws ScorerError('quota') without calling the inner scorer once the daily cap is reached", async () => {
    const db = openDatabase(":memory:");
    try {
      const inner = new CountingScorer();
      const scorer = new CachedScorer(db, inner, { ...BASE_OPTIONS, dailyCallCap: 1 });

      await scorer.score("蘋果", "水果");
      expect(inner.calls).toBe(1);

      const error: unknown = await scorer.score("天空", "雲").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ScorerError);
      expect((error as ScorerError).reason).toBe("quota");
      expect(inner.calls).toBe(1);
    } finally {
      db.close();
    }
  });

  it("throws quota immediately when the cap is zero", async () => {
    const db = openDatabase(":memory:");
    try {
      const inner = new CountingScorer();
      const scorer = new CachedScorer(db, inner, { ...BASE_OPTIONS, dailyCallCap: 0 });

      await expect(scorer.score("蘋果", "水果")).rejects.toMatchObject({ reason: "quota" });
      expect(inner.calls).toBe(0);
    } finally {
      db.close();
    }
  });

  it("propagates an inner failure without poisoning the cache", async () => {
    const db = openDatabase(":memory:");
    try {
      let calls = 0;
      const inner = new CountingScorer(() => {
        calls += 1;
        if (calls === 1) throw new ScorerError("scorer_error", "model unavailable");
        return { score: 88, isNoun: true };
      });
      const scorer = new CachedScorer(db, inner, BASE_OPTIONS);

      await expect(scorer.score("蘋果", "水果")).rejects.toThrow("model unavailable");
      expect(inner.calls).toBe(1);

      expect(await scorer.score("蘋果", "水果")).toEqual({ score: 88, isNoun: true });
      expect(inner.calls).toBe(2);

      // The successful pair score is now cached; the reversed hint needs its own noun lookup.
      expect(await scorer.score("水果", "蘋果")).toEqual({ score: 88, isNoun: true });
      expect(inner.calls).toBe(3);

      // Both rows for the reversed request are cached now.
      expect(await scorer.score("水果", "蘋果")).toEqual({ score: 88, isNoun: true });
      expect(inner.calls).toBe(3);
    } finally {
      db.close();
    }
  });
});

describe("FakeScorer", () => {
  it("is deterministic and symmetric for the same pair", async () => {
    const scorer = new FakeScorer();
    const first = await scorer.score("蘋果", "石頭");
    const second = await scorer.score("蘋果", "石頭");
    const reversed = await scorer.score("石頭", "蘋果");

    expect(first).toEqual(second);
    expect(reversed.score).toBe(first.score);
    expect(first.score).toBeGreaterThanOrEqual(10);
    expect(first.score).toBeLessThanOrEqual(59);
  });

  it("scores identical words 100 and shared characters 70 + 8 per char (cap 94)", async () => {
    const scorer = new FakeScorer({}, []);

    expect(await scorer.score("蘋果", "蘋果")).toEqual({ score: 100, isNoun: true });
    expect((await scorer.score("大學", "學校")).score).toBe(78);
    expect((await scorer.score("東南西北", "東南西北中")).score).toBe(94);
  });

  it("honours the table and the non-noun list", async () => {
    const scorer = new FakeScorer({ [fakePairKey("甲", "乙")]: { score: 96, isNoun: false } }, ["漂亮"]);

    expect(await scorer.score("甲", "乙")).toEqual({ score: 96, isNoun: false });
    expect(await scorer.score("乙", "甲")).toEqual({ score: 96, isNoun: false });

    const notNoun = await scorer.score("學校", "漂亮");
    expect(notNoun.isNoun).toBe(false);
  });

  it("ships near-synonym defaults in the instant-reveal band", async () => {
    expect(DEFAULT_FAKE_TABLE[fakePairKey("醫院", "病院")]?.score).toBeGreaterThanOrEqual(95);

    const scorer = new FakeScorer();
    expect((await scorer.score("醫院", "病院")).score).toBeGreaterThanOrEqual(95);
    expect((await scorer.score("病院", "醫院")).score).toBeGreaterThanOrEqual(95);
  });
});

describe("calibration metrics", () => {
  it("maps scores onto golden bands at the boundaries", () => {
    expect(bandOf(100)).toBe("top");
    expect(bandOf(95)).toBe("top");
    expect(bandOf(94)).toBe("high");
    expect(bandOf(80)).toBe("high");
    expect(bandOf(79)).toBe("mid");
    expect(bandOf(60)).toBe("mid");
    expect(bandOf(59)).toBe("weak");
    expect(bandOf(30)).toBe("weak");
    expect(bandOf(29)).toBe("none");
    expect(bandOf(0)).toBe("none");
  });

  it("computes Spearman ρ for perfect, inverse and tied rankings", () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBeCloseTo(-1, 10);
    expect(spearman([1, 2, 3], [7, 7, 7])).toBe(0);
    expect(spearman([1], [3])).toBe(0);
    expect(() => spearman([1, 2], [1])).toThrow(/length mismatch/);
  });

  it("builds a 5×5 confusion matrix and band accuracy", () => {
    const results = [
      { expected: "top" as const, actual: "top" as const },
      { expected: "top" as const, actual: "mid" as const },
      { expected: "none" as const, actual: "none" as const },
    ];

    const matrix = confusionMatrix(results);
    expect(matrix.top.top).toBe(1);
    expect(matrix.top.mid).toBe(1);
    expect(matrix.none.none).toBe(1);
    expect(matrix.weak.high).toBe(0);
    expect(bandAccuracy(results)).toBeCloseTo(2 / 3, 10);
    expect(bandAccuracy([])).toBe(0);
  });

  it("keeps the golden dataset broad enough for the calibration gate", () => {
    const golden = JSON.parse(
      readFileSync(new URL("../data/golden.zh-TW.json", import.meta.url), "utf8"),
    ) as { pairs: Array<{ band: string }>; groups: Array<{ ranked: string[] }> };

    expect(golden.pairs.length).toBeGreaterThanOrEqual(60);
    expect(golden.groups.length).toBeGreaterThanOrEqual(8);

    const counts = new Map<string, number>();
    for (const pair of golden.pairs) {
      counts.set(pair.band, (counts.get(pair.band) ?? 0) + 1);
    }
    for (const band of ["top", "high", "mid", "weak", "none"]) {
      expect(counts.get(band) ?? 0).toBeGreaterThanOrEqual(10);
    }
    for (const group of golden.groups) {
      expect(group.ranked).toHaveLength(5);
    }
  });
});
