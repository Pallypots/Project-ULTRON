import type { Db } from "./db.ts";
import { now } from "./util.ts";

/** Non-secret owner preferences (provider choice, model, UI options). Secrets live elsewhere. */
export class PreferenceStore {
  constructor(private db: Db) {}

  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value FROM preferences WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : fallback;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), now());
  }
}
