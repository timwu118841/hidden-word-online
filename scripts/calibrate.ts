/**
 * Calibration gate for the real judge model (plan AC 12).
 *
 *   OPENAI_API_KEY=... npx tsx scripts/calibrate.ts [--cache <dbpath>]
 *
 * Prints band accuracy, the 5×5 confusion table and Spearman ρ per ranked group,
 * then exits 0 only when accuracy ≥ 0.85 and mean ρ ≥ 0.7.
 */
import { readFileSync } from "node:fs";
import { openDatabase, type Db } from "../apps/server/src/db/sqlite";
import { CachedScorer } from "../apps/server/src/scoring/CachedScorer";
import { LlmJudgeScorer } from "../apps/server/src/scoring/LlmJudgeScorer";
import { PROMPT_VERSION } from "../apps/server/src/scoring/prompt";
import {
  GOLDEN_BANDS,
  bandAccuracy,
  bandOf,
  confusionMatrix,
  mean,
  spearman,
  type BandResult,
  type GoldenBand,
} from "../apps/server/src/scoring/calibration";
import type { Scorer } from "../apps/server/src/scoring/Scorer";

interface GoldenPair {
  a: string;
  b: string;
  band: GoldenBand;
}

interface GoldenGroup {
  target: string;
  ranked: string[];
}

interface GoldenData {
  pairs: GoldenPair[];
  groups: GoldenGroup[];
}

const GOLDEN_URL = new URL("../apps/server/data/golden.zh-TW.json", import.meta.url);
const MIN_ACCURACY = 0.85;
const MIN_MEAN_RHO = 0.7;

const BAND_LABELS: Record<GoldenBand, string> = {
  top: "top 95-100",
  high: "high 80-94",
  mid: "mid 60-79",
  weak: "weak 30-59",
  none: "none 0-29",
};

async function main(): Promise<number> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    console.error("未設定 OPENAI_API_KEY，無法執行真實模型的校準。");
    console.error("請先設定環境變數後重試，例如：");
    console.error("  OPENAI_API_KEY=sk-... npx tsx scripts/calibrate.ts");
    return 2;
  }

  let cachePath: string | undefined;
  try {
    cachePath = readCachePath(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const golden = loadGolden();
  const judge = new LlmJudgeScorer({ apiKey });
  const dailyCap = parsePositiveInt(process.env.SCORER_DAILY_CALL_CAP, 20_000);

  let db: Db | undefined;
  let scorer: Scorer = judge;
  if (cachePath !== undefined) {
    db = openDatabase(cachePath);
    scorer = new CachedScorer(db, judge, {
      model: judge.modelId,
      promptVersion: PROMPT_VERSION,
      dailyCallCap: dailyCap,
    });
  }

  console.log(`模型：${judge.modelId}`);
  console.log(`提示詞版本：${PROMPT_VERSION}`);
  console.log(`題數：${golden.pairs.length} 組配對、${golden.groups.length} 組排序`);
  if (cachePath !== undefined) console.log(`快取資料庫：${cachePath}`);
  console.log("");

  try {
    const results: BandResult[] = [];
    for (const [index, pair] of golden.pairs.entries()) {
      const result = await scorer.score(pair.a, pair.b);
      const actual = bandOf(result.score);
      results.push({ expected: pair.band, actual });
      const mark = actual === pair.band ? "✓" : "✗";
      console.log(
        `${String(index + 1).padStart(2)}. ${mark} ${pair.a} / ${pair.b}：${result.score}（預期 ${pair.band}，實際 ${actual}）`,
      );
    }

    const accuracy = bandAccuracy(results);
    const matrix = confusionMatrix(results);

    console.log("");
    console.log(`分數帶準確率：${(accuracy * 100).toFixed(1)}%（門檻 ${(MIN_ACCURACY * 100).toFixed(0)}%）`);
    console.log("");
    console.log("混淆矩陣（列＝預期，欄＝實際）");
    console.log(`${"預期\\實際".padEnd(12)}${GOLDEN_BANDS.map((band) => BAND_LABELS[band].padEnd(12)).join("")}`);
    for (const expected of GOLDEN_BANDS) {
      const row = GOLDEN_BANDS.map((actual) => String(matrix[expected][actual]).padEnd(12)).join("");
      console.log(`${BAND_LABELS[expected].padEnd(12)}${row}`);
    }

    console.log("");
    console.log("排序相關（Spearman ρ，1 代表完全符合由好到壞的順序）");
    const rhos: number[] = [];
    for (const group of golden.groups) {
      const scores: number[] = [];
      for (const hint of group.ranked) {
        const result = await scorer.score(group.target, hint);
        scores.push(result.score);
      }
      const expectedRanks = group.ranked.map((_, index) => group.ranked.length - index);
      const rho = spearman(expectedRanks, scores);
      rhos.push(rho);
      const formatted = group.ranked.map((hint, index) => `${hint}:${scores[index]}`).join("、");
      console.log(`- ${group.target}：ρ = ${rho.toFixed(3)}　[${formatted}]`);
    }

    const meanRho = mean(rhos);
    console.log("");
    console.log(`平均 ρ：${meanRho.toFixed(3)}（門檻 ${MIN_MEAN_RHO}）`);

    const passed = accuracy >= MIN_ACCURACY && meanRho >= MIN_MEAN_RHO;
    console.log("");
    console.log(passed ? "校準通過。" : "校準未通過。");
    return passed ? 0 : 1;
  } finally {
    db?.close();
  }
}

function readCachePath(args: readonly string[]): string | undefined {
  const index = args.indexOf("--cache");
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--cache 需要一個資料庫路徑，例如：--cache .cache/scores.db");
  }
  return value;
}

function loadGolden(): GoldenData {
  const parsed: unknown = JSON.parse(readFileSync(GOLDEN_URL, "utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("golden.zh-TW.json 格式錯誤：最外層必須是物件");
  }
  const { pairs, groups } = parsed as Partial<GoldenData>;
  if (!Array.isArray(pairs) || !Array.isArray(groups)) {
    throw new Error("golden.zh-TW.json 格式錯誤：缺少 pairs 或 groups 陣列");
  }
  return { pairs, groups };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const exitCode = await main().catch((error: unknown) => {
  console.error(`校準失敗：${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
process.exit(exitCode);
