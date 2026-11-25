/**
 * Judge prompt for the 隱藏詞 relatedness scorer.
 *
 * Bumping PROMPT_VERSION starts a fresh cache namespace: every pair and noun flag
 * is scored again. Keep the rubric and the JSON schema in sync when editing.
 */
export const PROMPT_VERSION = "hw-zh-tw-2026-11-v1";

/**
 * Static rubric. The words are NEVER interpolated into this text; they travel as
 * JSON data in the user message so hint text cannot rewrite the instructions.
 */
export const SYSTEM_PROMPT = `你是「隱藏詞」桌遊的計分員。玩家會給你兩個繁體中文詞，你要判斷「這兩個詞」的語意關聯強度，並判斷第二個詞是不是名詞。

評分規則（0 到 100 的整數）：
- 100：兩個詞完全相同。
- 95–99：同義詞或幾乎同義（例如「醫生」與「醫師」）。
- 80–94：有強烈的直接關係，例如整體與部分、工具與使用者、場所與在其中活動的人、具有代表性的標誌物。
- 60–79：有明確、一般人會想到的關聯。
- 30–59：只有較弱的主題關聯，需要多想一步才連得起來。
- 0–29：幾乎無關，或只是偶然共享字面。

評分必須對稱：把兩個詞對調後，分數應該相同。請以一般台灣玩家的直覺判斷，不要因為詞語的筆畫、讀音或字面相同而加分。

分數錨點範例（僅供校準刻度，不要套用到實際題目）：
- 「醫生」與「醫師」：97
- 「醫院」與「病院」：95
- 「醫生」與「醫院」：88
- 「廚師」與「廚房」：86
- 「老師」與「黑板」：82
- 「醫生」與「護士」：74
- 「警察」與「手銬」：72
- 「咖啡」與「失眠」：52
- 「月亮」與「狼」：42
- 「醫生」與「拖鞋」：3
- 「月亮」與「冰箱」：1

另外，請判斷第二個詞（提示詞）是否為名詞。具體名詞、抽象名詞、人名、地名、專有名詞都算名詞；動詞、形容詞、副詞、量詞、語氣詞不算名詞。

只輸出符合指定 JSON schema 的物件，不要加任何說明文字。`;

export interface JudgeUserPayload {
  "詞一": string;
  "詞二": string;
}

/** Serializes the two words as data (never as instructions). */
export function buildUserPrompt(hidden: string, hint: string): string {
  const payload: JudgeUserPayload = { "詞一": hidden, "詞二": hint };
  return JSON.stringify(payload);
}

/** Structured-output schema: `{ score: integer 0..100, isNoun: boolean }`. */
export const JUDGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "這兩個詞的語意關聯強度，0（無關）到 100（完全相同）。",
    },
    isNoun: {
      type: "boolean",
      description: "第二個詞（提示詞）是否為名詞。",
    },
  },
  required: ["score", "isNoun"],
} as const;

export const JUDGE_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "hidden_word_score",
  description: "隱藏詞的關聯分數與詞性判斷。",
  schema: JUDGE_JSON_SCHEMA,
  strict: true,
} as const;
