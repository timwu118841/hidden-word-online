import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as OpenCC from "opencc-js";
import { afterAll, describe, expect, it } from "vitest";
import { drawEnvelopes, loadNouns } from "../src/words/envelope";

// Same conversion `normalizeWord` applies (Simplified → Traditional, Taiwan).
const toTaiwan = OpenCC.Converter({ from: "cn", to: "tw" });

/** Small deterministic PRNG so a deal can be reproduced. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("loadNouns", () => {
  it("reads the bundled list by default", () => {
    const words = loadNouns();
    expect(words.length).toBeGreaterThan(0);
    expect(words.every((word) => typeof word === "string")).toBe(true);
  });

  it("rejects a payload that is not an array of strings", () => {
    const dir = mkdtempSync(join(tmpdir(), "hw-nouns-"));
    tempDirs.push(dir);
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ words: ["醫院"] }), "utf8");
    expect(() => loadNouns(file)).toThrow(/字串陣列/);

    const mixed = join(dir, "mixed.json");
    writeFileSync(mixed, JSON.stringify(["醫院", 42]), "utf8");
    expect(() => loadNouns(mixed)).toThrow(/字串陣列/);
  });

  it("rejects malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "hw-nouns-"));
    tempDirs.push(dir);
    const file = join(dir, "broken.json");
    writeFileSync(file, "[醫院", "utf8");
    expect(() => loadNouns(file)).toThrow(/無法解析/);
  });
});

describe("drawEnvelopes", () => {
  it("deals 7 players × 2 rounds × 5 words with no word reused", () => {
    const playerIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const words = Array.from({ length: 90 }, (_, i) => `詞${i}`);

    const envelopes = drawEnvelopes(playerIds, 2, 5, words);

    expect(Object.keys(envelopes).sort()).toEqual([...playerIds].sort());
    for (const playerId of playerIds) {
      const perRound = envelopes[playerId]!;
      expect(perRound).toHaveLength(2);
      for (const round of perRound) expect(round).toHaveLength(5);
    }

    const dealt = playerIds.flatMap((playerId) => envelopes[playerId]!.flat());
    expect(dealt).toHaveLength(70);
    expect(new Set(dealt).size).toBe(70);
    for (const word of dealt) expect(words).toContain(word);
  });

  it("does not mutate the source word list", () => {
    const words = ["醫院", "雨傘", "颱風", "便當", "捷運", "夜市"];
    const before = [...words];
    drawEnvelopes(["p1"], 1, 3, words);
    expect(words).toEqual(before);
  });

  it("throws when the pool cannot fill every envelope", () => {
    const words = Array.from({ length: 69 }, (_, i) => `詞${i}`);
    expect(() => drawEnvelopes(["p1", "p2", "p3", "p4", "p5", "p6", "p7"], 2, 5, words)).toThrow(
      /單詞不足/,
    );
  });

  it("is deterministic for a given seed", () => {
    const playerIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const words = Array.from({ length: 90 }, (_, i) => `詞${i}`);

    const first = drawEnvelopes(playerIds, 2, 5, words, mulberry32(20261125));
    const second = drawEnvelopes(playerIds, 2, 5, words, mulberry32(20261125));
    const other = drawEnvelopes(playerIds, 2, 5, words, mulberry32(7));

    expect(second).toEqual(first);
    expect(other).not.toEqual(first);
  });
});

describe("nouns.zh-TW.json", () => {
  const words = loadNouns();

  it("holds 600–800 unique entries", () => {
    expect(words.length).toBeGreaterThanOrEqual(600);
    expect(words.length).toBeLessThanOrEqual(800);
    expect(new Set(words).size).toBe(words.length);
  });

  it("contains only 2–3 Han characters per entry", () => {
    for (const word of words) {
      expect(word, word).toMatch(/^\p{Script=Han}{2,3}$/u);
    }
  });

  it("is already Traditional Chinese in Taiwan usage", () => {
    for (const word of words) {
      expect(toTaiwan(word), word).toBe(word);
    }
  });
});
