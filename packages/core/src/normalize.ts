import { Converter } from "opencc-js/cn2t";

/**
 * Answer / hint normalization shared by the server judge and the client preview.
 *
 * Kept in its own module (exported as `@hw/core/normalize`) so that the heavy
 * OpenCC dictionaries never reach the browser bundle of consumers that only
 * need the rest of the core package.
 */

/** Whitespace, punctuation and symbols are dropped after NFKC folding. */
const STRIPPED = /[\s\p{P}\p{S}]/gu;

/** A valid hint / answer is 1..maxLen Han code points. */
const HAN_ONLY = /^\p{Script=Han}+$/u;

let convert: ((text: string) => string) | null = null;

/** Built once, lazily: building the trie is the expensive part. */
function toTraditional(text: string): string {
  if (convert === null) convert = Converter({ from: "cn", to: "tw" });
  return convert(text);
}

/**
 * NFKC → trim → strip whitespace/punctuation/symbols → Simplified → Traditional (Taiwan).
 *
 * Character-level conversion on purpose: phrase-level `twp` rewrites whole words
 * unpredictably, which would make judging depend on dictionary phrases.
 */
export function normalizeWord(raw: string): string {
  const cleaned = raw.normalize("NFKC").trim().replace(STRIPPED, "");
  if (cleaned.length === 0) return "";
  return toTraditional(cleaned);
}

/** True when `word` is 1..maxLen Han characters (code points) and nothing else. */
export function isValidWordFormat(word: string, maxLen: number): boolean {
  if (!HAN_ONLY.test(word)) return false;
  const length = [...word].length;
  return length >= 1 && length <= maxLen;
}
