import { createApp } from "./app";
import { openDatabase, type Db } from "./db/sqlite";
import { loadEnv, type Env } from "./env";
import { CachedScorer } from "./scoring/CachedScorer";
import { DEFAULT_FAKE_TABLE, FakeScorer } from "./scoring/FakeScorer";
import { LlmJudgeScorer } from "./scoring/LlmJudgeScorer";
import { PROMPT_VERSION } from "./scoring/prompt";
import type { Scorer } from "./scoring/Scorer";
import { loadNouns } from "./words/envelope";

interface BuiltScorer {
  scorer: Scorer;
  db: Db | null;
}

function buildScorer(env: Env): BuiltScorer {
  if (env.scorer === "fake") {
    return { scorer: new FakeScorer(DEFAULT_FAKE_TABLE), db: null };
  }

  const apiKey = env.openaiApiKey;
  if (apiKey === undefined) {
    throw new Error("SCORER=llm 需要在環境變數提供 OPENAI_API_KEY");
  }

  const db = openDatabase(env.databasePath);
  const scorer = new CachedScorer(db, new LlmJudgeScorer({ apiKey, model: env.openaiModel }), {
    model: env.openaiModel,
    promptVersion: PROMPT_VERSION,
    dailyCallCap: env.scorerDailyCallCap,
  });
  return { scorer, db };
}

const env = loadEnv();
const { scorer, db } = buildScorer(env);
const app = createApp({
  scorer,
  words: loadNouns(),
  clientDist: env.clientDist,
  rulesOverride: env.rulesOverride,
});

app.httpServer.on("error", (error) => {
  console.error("[server] HTTP 伺服器錯誤", error);
  process.exitCode = 1;
});

app.httpServer.listen(env.port, () => {
  console.log(`[server] 隱藏詞 Online 已啟動：http://localhost:${env.port}（scorer=${env.scorer}）`);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] 收到 ${signal}，正在關閉…`);
  try {
    await app.close();
  } catch (error) {
    console.error("[server] 關閉時發生錯誤", error);
  } finally {
    db?.close();
    process.exit(0);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
