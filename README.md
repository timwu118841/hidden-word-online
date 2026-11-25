# 隱藏詞 Online

線上多人版「魔鬼的計謀: Dead Again」第 5 天主賽〈隱藏詞〉（히든 워드）。粉絲自製，與 Netflix 及製作公司 TEO 無關。

每位玩家從信封的 5 個詞中秘密選一個隱藏詞。輪到出題時，出題者送出提示名詞，AI 為「提示 ↔ 隱藏詞」的關聯度打 0–100 分；其他人只看得到分數。每階段只公開一個提示（≥95 分立即公開，否則公開最高分），其他人據此猜詞。

## 規則（預設值，見 `packages/core/src/config.ts`）

| 項目 | 預設 |
|---|---|
| 人數 | 2–7 |
| 回合數 | 快速 1／正式 2（第 2 回合分數 ×2） |
| 每位出題者階段數 | 3 |
| 每階段提示上限 | 5 |
| 立即公開門檻 | 95 分 |
| 出題者得分門檻 | 公開提示 ≥ 60 分 |
| 出題者得分 | 該階段無人猜中：第 1/2/3 階段 +1/+2/+3（累計） |
| 猜中者得分 | +1，該出題回合結束 |
| 棋子 | 每人 1 枚；每回合可用 1 次，多猜一個答案 |
| 時限（秒） | 選詞 60／提示 120／猜詞 45／結果 8 |
| 斷線寬限 | 60 秒，逾時視為離開（輪到出題時跳過） |

節目確切規則無法完整查證，標記為推測的數值都可在 `config.ts` 調整。

## 開發

需求：Node 24+、npm 11。

```bash
npm install
npm run dev          # 伺服器 :3000（SCORER=fake，不需 API key）+ Vite :5173
```

開啟 http://localhost:5173 。

| 指令 | 用途 |
|---|---|
| `npm test` | 單元與整合測試（Vitest） |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run e2e` | Playwright 三人完整對局 |
| `npm run calibrate` | 用真實模型跑校準集（需 `OPENAI_API_KEY`） |
| `npm run build && npm start` | 正式模式：伺服器同時提供前端 |

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | 3000 | |
| `SCORER` | 有 key 時 `llm`，否則 `fake` | `fake` 為可重現的假評分器 |
| `OPENAI_API_KEY` | — | `SCORER=llm` 時必填，只在伺服器端使用 |
| `OPENAI_MODEL` | `gpt-6-luna` | 評分模型 |
| `DATABASE_PATH` | `./data/hidden-word.sqlite` | 分數快取（同一組詞永遠同分） |
| `SCORER_DAILY_CALL_CAP` | 20000 | 每日模型呼叫上限 |
| `CLIENT_DIST` | `apps/client/dist` | 前端建置輸出 |
| `HW_RULES_OVERRIDE` | — | JSON 覆寫 `RuleConfig` 規則參數（e2e 用來縮短階段計時；未知鍵會被拒絕） |
| `TRUST_PROXY` | — | 設為 `1` 時以 `X-Forwarded-For` 判斷 IP |

## 架構

```
packages/core   規則設定、型別、通訊協定、純函式 reducer、每位玩家的可見畫面（view）、詞語正規化
apps/server     node:http + Socket.IO、房間執行環境（計時器、評分）、SQLite 分數快取、詞庫
apps/client     Vite + React 前端
scripts         calibrate.ts（模型校準）
e2e             Playwright 測試
```

- 伺服器掌握完整狀態，每位玩家只收到依白名單產生的畫面：別人的隱藏詞、信封與未公開的提示詞永遠不會送到瀏覽器。
- 評分：LLM 依評分準則（0–100）判斷關聯度並同時判斷是否為名詞；結果永久快取於 SQLite（`pair_scores`、`word_pos`）。
- 單一程序部署；房間存在記憶體，伺服器重啟會結束進行中的對局。

## 部署（Fly.io）

```bash
fly launch --no-deploy        # 使用現有 fly.toml
fly volumes create hw_data --size 1
fly secrets set OPENAI_API_KEY=...
fly deploy
```

## 詞庫

`apps/server/data/nouns.zh-TW.json`：約 800 個手工整理的臺灣常用名詞（2–3 字），未取自任何授權詞表。
