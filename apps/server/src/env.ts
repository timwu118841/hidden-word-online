import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { RulesOverride } from "./rooms/RoomManager";

const DEFAULT_PORT = 3000;
const DEFAULT_OPENAI_MODEL = "gpt-6-luna";
const DEFAULT_DATABASE_PATH = "./data/hidden-word.sqlite";
const DEFAULT_SCORER_DAILY_CALL_CAP = 20_000;

/** `apps/client/dist`, resolved from this file so cwd does not matter. */
const DEFAULT_CLIENT_DIST = fileURLToPath(new URL("../../../apps/client/dist", import.meta.url));

const phaseTimersOverrideSchema = z.strictObject({
  pickMs: z.number().int().nonnegative().optional(),
  hintMs: z.number().int().nonnegative().optional(),
  guessMs: z.number().int().nonnegative().optional(),
  resultMs: z.number().int().nonnegative().optional(),
});

/**
 * `HW_RULES_OVERRIDE` accepts a JSON object with any subset of `RuleConfig`
 * (timers merged field-by-field). Unknown keys are rejected so a typo cannot
 * silently fall back to the defaults. E2E runs use it to shorten phase timers.
 */
const rulesOverrideSchema = z.strictObject({
  minPlayers: z.number().int().min(2).optional(),
  maxPlayers: z.number().int().min(2).max(7).optional(),
  envelopeSize: z.number().int().min(1).optional(),
  rounds: z.number().int().min(1).optional(),
  roundMultiplier: z.array(z.number().nonnegative()).min(1).optional(),
  stagesPerTurn: z.number().int().min(1).optional(),
  maxHintsPerStage: z.number().int().min(1).optional(),
  instantRevealThreshold: z.number().int().min(0).max(100).optional(),
  minRevealScoreForSetter: z.number().int().min(0).max(100).optional(),
  setterStagePoints: z.array(z.number().int().nonnegative()).min(1).optional(),
  guesserPoints: z.number().int().nonnegative().optional(),
  startingPieces: z.number().int().nonnegative().optional(),
  maxWordLength: z.number().int().min(1).optional(),
  timers: phaseTimersOverrideSchema.optional(),
  disconnectGraceMs: z.number().int().nonnegative().optional(),
});

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SCORER: z.enum(["fake", "llm"]).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  DATABASE_PATH: z.string().min(1).optional(),
  SCORER_DAILY_CALL_CAP: z.coerce.number().int().min(0).optional(),
  CLIENT_DIST: z.string().min(1).optional(),
  HW_RULES_OVERRIDE: z.string().min(1).optional(),
});

export interface Env {
  port: number;
  scorer: "fake" | "llm";
  openaiApiKey: string | undefined;
  openaiModel: string;
  databasePath: string;
  scorerDailyCallCap: number;
  clientDist: string;
  rulesOverride: RulesOverride | undefined;
}

/**
 * Parses process env once at startup. Empty strings count as unset, because
 * `FOO=` is how shells and container configs usually express "not provided".
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== "") cleaned[key] = value;
  }

  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`環境變數設定錯誤：\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;

  const scorer = env.SCORER ?? (env.OPENAI_API_KEY !== undefined ? "llm" : "fake");
  if (scorer === "llm" && env.OPENAI_API_KEY === undefined) {
    throw new Error("SCORER=llm 需要在環境變數提供 OPENAI_API_KEY");
  }
  if (env.SCORER === undefined && scorer === "fake") {
    console.warn("[env] 未設定 OPENAI_API_KEY，使用 FakeScorer（SCORER=fake）。");
  }

  let rulesOverride: RulesOverride | undefined;
  if (env.HW_RULES_OVERRIDE !== undefined) {
    let raw: unknown;
    try {
      raw = JSON.parse(env.HW_RULES_OVERRIDE);
    } catch {
      throw new Error("環境變數設定錯誤：HW_RULES_OVERRIDE 必須是合法 JSON");
    }
    const parsedRules = rulesOverrideSchema.safeParse(raw);
    if (!parsedRules.success) {
      throw new Error(`環境變數設定錯誤：\n${z.prettifyError(parsedRules.error)}`);
    }
    rulesOverride = parsedRules.data;
  }

  return {
    port: env.PORT ?? DEFAULT_PORT,
    scorer,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    databasePath: env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
    scorerDailyCallCap: env.SCORER_DAILY_CALL_CAP ?? DEFAULT_SCORER_DAILY_CALL_CAP,
    clientDist: env.CLIENT_DIST ?? DEFAULT_CLIENT_DIST,
    rulesOverride,
  };
}
