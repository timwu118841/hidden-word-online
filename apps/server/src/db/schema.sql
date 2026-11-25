-- Persistent scorer caches. Live rooms stay in memory; only these tables survive restarts.

-- One row per unordered word pair, model and prompt version. First score wins.
CREATE TABLE IF NOT EXISTS pair_scores (
  key            TEXT PRIMARY KEY,
  score          INTEGER NOT NULL,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

-- Noun flag for the hint word only (the pair key cannot carry it).
CREATE TABLE IF NOT EXISTS word_pos (
  key            TEXT PRIMARY KEY,
  word           TEXT NOT NULL,
  is_noun        INTEGER NOT NULL,
  model          TEXT,
  prompt_version TEXT
);

-- Daily LLM call counter, keyed by UTC date (YYYY-MM-DD).
CREATE TABLE IF NOT EXISTS llm_usage (
  day   TEXT PRIMARY KEY,
  calls INTEGER NOT NULL
);
