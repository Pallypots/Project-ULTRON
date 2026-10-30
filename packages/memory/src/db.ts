import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./migrations.ts";

export type Db = DatabaseSync;

/** Opens (or creates) the ULTRON database and applies pending migrations. */
export function openDatabase(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: Db): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  const ran: number[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.up);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      ran.push(m.version);
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`);
    }
  }
  return ran;
}

/** Reverts migrations above `target` (used by tests and recovery tooling). */
export function rollback(db: Db, target = 0): number[] {
  const reverted: number[] = [];
  for (const m of [...MIGRATIONS].reverse()) {
    if (m.version <= target) break;
    const row = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(m.version);
    if (!row) continue;
    db.exec("BEGIN");
    db.exec(m.down);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(m.version);
    db.exec("COMMIT");
    reverted.push(m.version);
  }
  return reverted;
}
