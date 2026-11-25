import type { ScoreResult, Scorer } from "./Scorer";

/**
 * Deterministic scorer for local dev (SCORER=fake), integration tests and e2e.
 *
 * Rules, in order:
 *  1. identical words → 100;
 *  2. explicit table hit (keyed by the sorted pair);
 *  3. hint in `nonNouns` → `isNoun: false`;
 *  4. words sharing at least one character → 70 + 8 × shared characters (cap 94);
 *  5. otherwise a stable hash of the sorted pair → 10..59.
 */
export class FakeScorer implements Scorer {
  private readonly table: Record<string, ScoreResult>;
  private readonly nonNouns: Set<string>;

  constructor(table: Record<string, ScoreResult> = DEFAULT_FAKE_TABLE, nonNouns: Iterable<string> = []) {
    this.table = table;
    this.nonNouns = new Set(nonNouns);
  }

  async score(hidden: string, hint: string): Promise<ScoreResult> {
    if (hidden === hint) return { score: 100, isNoun: true };

    const key = fakePairKey(hidden, hint);
    const tabled = this.table[key];
    if (tabled !== undefined) return { ...tabled };

    const score = relatedScore(hidden, hint);
    return { score, isNoun: !this.nonNouns.has(hint) };
  }
}

/** Unordered-pair key used by both the fake table and callers building one. */
export function fakePairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function relatedScore(hidden: string, hint: string): number {
  const hintChars = new Set(hint);
  let shared = 0;
  for (const ch of new Set(hidden)) {
    if (hintChars.has(ch)) shared += 1;
  }
  if (shared > 0) return Math.min(94, 70 + 8 * shared);
  return 10 + (fnv1a(fakePairKey(hidden, hint)) % 50);
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Near-synonym pairs scoring in the instant-reveal band (≥ 95), so e2e games can
 * end a stage without relying on character overlap.
 */
const NEAR_SYNONYMS: ReadonlyArray<readonly [string, string, number]> = [
  ["醫院", "病院", 98],
  ["醫生", "醫師", 98],
  ["老師", "教師", 97],
  ["汽車", "轎車", 96],
  ["廁所", "洗手間", 96],
  ["手機", "行動電話", 97],
  ["番茄", "西紅柿", 96],
  ["腳踏車", "自行車", 97],
  ["冷氣", "空調", 95],
  ["月亮", "月球", 96],
  ["馬鈴薯", "土豆", 96],
  ["護士", "護理師", 97],
  ["冰箱", "電冰箱", 98],
];

export const DEFAULT_FAKE_TABLE: Record<string, ScoreResult> = Object.fromEntries(
  NEAR_SYNONYMS.map(([a, b, score]) => [fakePairKey(a, b), { score, isNoun: true }]),
);
