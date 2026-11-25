import { readFileSync } from "node:fs";

const DEFAULT_NOUNS_URL = new URL("../../data/nouns.zh-TW.json", import.meta.url);

/**
 * Reads the curated noun list. Accepts a filesystem path or a file URL
 * (the default points at `apps/server/data/nouns.zh-TW.json`).
 */
export function loadNouns(path: string | URL = DEFAULT_NOUNS_URL): string[] {
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`無法解析單詞檔：${String(path)}`, { cause });
  }
  if (!Array.isArray(parsed) || !parsed.every((word): word is string => typeof word === "string")) {
    throw new Error(`單詞檔必須是字串陣列：${String(path)}`);
  }
  return parsed;
}

/**
 * Deals `rounds` envelopes of `size` words to every player, drawing from a
 * single shuffled pool so no word is handed out twice in the same room.
 *
 * `rand` is injectable so tests can reproduce a deal; it must return a value
 * in `[0, 1)`.
 */
export function drawEnvelopes(
  playerIds: readonly string[],
  rounds: number,
  size: number,
  words: readonly string[],
  rand: () => number = Math.random,
): Record<string, string[][]> {
  const needed = playerIds.length * rounds * size;
  if (needed > words.length) {
    throw new Error(`單詞不足：需要 ${needed} 個，僅有 ${words.length} 個`);
  }

  const pool = [...words];
  // Partial Fisher–Yates: only the first `needed` positions matter.
  for (let i = 0; i < needed; i++) {
    const remaining = pool.length - i;
    const offset = Math.min(Math.floor(rand() * remaining), remaining - 1);
    const j = i + offset;
    const picked = pool[j]!;
    pool[j] = pool[i]!;
    pool[i] = picked;
  }

  const envelopes: Record<string, string[][]> = {};
  let cursor = 0;
  for (const playerId of playerIds) {
    const perRound: string[][] = [];
    for (let round = 0; round < rounds; round++) {
      perRound.push(pool.slice(cursor, cursor + size));
      cursor += size;
    }
    envelopes[playerId] = perRound;
  }
  return envelopes;
}
