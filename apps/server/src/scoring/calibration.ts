/**
 * Pure calibration metrics for `scripts/calibrate.ts` and unit tests.
 *
 * Golden data bands:
 *   top 95–100, high 80–94, mid 60–79, weak 30–59, none 0–29.
 */
export const GOLDEN_BANDS = ["top", "high", "mid", "weak", "none"] as const;

export type GoldenBand = (typeof GOLDEN_BANDS)[number];

export const BAND_RANGES: Record<GoldenBand, readonly [number, number]> = {
  top: [95, 100],
  high: [80, 94],
  mid: [60, 79],
  weak: [30, 59],
  none: [0, 29],
};

export function bandOf(score: number): GoldenBand {
  if (score >= BAND_RANGES.top[0]) return "top";
  if (score >= BAND_RANGES.high[0]) return "high";
  if (score >= BAND_RANGES.mid[0]) return "mid";
  if (score >= BAND_RANGES.weak[0]) return "weak";
  return "none";
}

export interface BandResult {
  expected: GoldenBand;
  actual: GoldenBand;
}

export type ConfusionMatrix = Record<GoldenBand, Record<GoldenBand, number>>;

export function confusionMatrix(results: readonly BandResult[]): ConfusionMatrix {
  const matrix = {} as ConfusionMatrix;
  for (const expected of GOLDEN_BANDS) {
    matrix[expected] = {} as Record<GoldenBand, number>;
    for (const actual of GOLDEN_BANDS) {
      matrix[expected][actual] = 0;
    }
  }
  for (const result of results) {
    matrix[result.expected][result.actual] += 1;
  }
  return matrix;
}

export function bandAccuracy(results: readonly BandResult[]): number {
  if (results.length === 0) return 0;
  let correct = 0;
  for (const result of results) {
    if (result.expected === result.actual) correct += 1;
  }
  return correct / results.length;
}

/**
 * Spearman rank correlation with average ranks for ties.
 * Returns 0 when either series has no variance (or fewer than 2 points).
 */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) {
    throw new Error(`spearman: length mismatch (${xs.length} vs ${ys.length})`);
  }

  const n = xs.length;
  if (n < 2) return 0;

  const rx = averageRanks(xs);
  const ry = averageRanks(ys);
  const mean = (n + 1) / 2;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (rx[i] ?? mean) - mean;
    const dy = (ry[i] ?? mean) - mean;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  if (varianceX === 0 || varianceY === 0) return 0;
  return covariance / Math.sqrt(varianceX * varianceY);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function averageRanks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index }));
  order.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i + 1;
    while (j < order.length && order[j]!.value === order[i]!.value) j += 1;
    // 1-based ranks i+1 .. j all tie; their average is (i + 1 + j) / 2.
    const tiedRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) {
      ranks[order[k]!.index] = tiedRank;
    }
    i = j;
  }
  return ranks;
}
