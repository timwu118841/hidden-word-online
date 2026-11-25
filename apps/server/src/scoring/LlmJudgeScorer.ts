import OpenAI from "openai";
import type { ScoreResult, Scorer } from "./Scorer";
import { ScorerError } from "./Scorer";
import { JUDGE_RESPONSE_FORMAT, SYSTEM_PROMPT, buildUserPrompt } from "./prompt";

export interface LlmJudgeScorerOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

const MAX_ATTEMPTS = 2;

/**
 * LLM-as-judge relatedness scorer using the OpenAI Responses API with a strict
 * JSON schema. One retry covers transient failures and timeouts; afterwards a
 * `ScorerError("scorer_error")` lets the room runtime report `HINT_FAILED`.
 */
export class LlmJudgeScorer implements Scorer {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor({ apiKey, model = process.env.OPENAI_MODEL ?? "gpt-6-luna", timeoutMs = 8000 }: LlmJudgeScorerOptions) {
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });
  }

  get modelId(): string {
    return this.model;
  }

  async score(hidden: string, hint: string): Promise<ScoreResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.client.responses.create(
          {
            model: this.model,
            instructions: SYSTEM_PROMPT,
            input: buildUserPrompt(hidden, hint),
            text: { format: JUDGE_RESPONSE_FORMAT },
            // No `temperature`: reasoning-tier models reject it; the pair cache provides stability.
            // Budget covers hidden reasoning tokens plus the tiny JSON answer.
            max_output_tokens: 512,
          },
          { timeout: this.timeoutMs },
        );
        return parseJudgeOutput(response.output_text);
      } catch (error) {
        lastError = error;
      }
    }

    throw new ScorerError(
      "scorer_error",
      `judge failed after ${MAX_ATTEMPTS} attempt(s): ${describeError(lastError)}`,
    );
  }
}

function parseJudgeOutput(text: string): ScoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("judge returned invalid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("judge returned a non-object");
  }

  const { score, isNoun } = parsed as { score?: unknown; isNoun?: unknown };
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("judge returned a non-numeric score");
  }
  if (typeof isNoun !== "boolean") {
    throw new Error("judge returned a non-boolean isNoun");
  }

  return { score: Math.min(100, Math.max(0, Math.round(score))), isNoun };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
