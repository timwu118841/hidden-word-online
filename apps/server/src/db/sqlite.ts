import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA_SQL = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/**
 * Opens (and creates) the scorer cache database and applies the schema.
 * `:memory:` is used by tests; file databases get WAL so reads never block writes.
 */
export function openDatabase(path: string): Db {
  const isMemory = path === ":memory:";
  if (!isMemory) mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  if (!isMemory) db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  return db;
}
