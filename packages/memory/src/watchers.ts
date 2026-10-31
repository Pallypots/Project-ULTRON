import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";

export interface Watcher {
  id: string;
  url: string;
  label: string;
  /** Text to wait for ("in stock"); null means "any change". */
  lookFor: string | null;
  everyMinutes: number;
  lastHash: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lastError: string | null;
  conversationId: string | null;
  createdAt: string;
  stoppedAt: string | null;
}

const toWatcher = (r: any): Watcher => ({
  id: r.id,
  url: r.url,
  label: r.label,
  lookFor: r.look_for,
  everyMinutes: r.every_minutes,
  lastHash: r.last_hash,
  lastCheckedAt: r.last_checked_at,
  lastChangedAt: r.last_changed_at,
  lastError: r.last_error,
  conversationId: r.conversation_id,
  createdAt: r.created_at,
  stoppedAt: r.stopped_at,
});

export class WatcherStore {
  constructor(private db: Db) {}

  create(w: { url: string; label: string; lookFor: string | null; everyMinutes: number; conversationId?: string | null }): Watcher {
    const id = uuid();
    this.db
      .prepare("INSERT INTO watchers (id, url, label, look_for, every_minutes, conversation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, w.url, w.label, w.lookFor, w.everyMinutes, w.conversationId ?? null, now());
    return this.get(id)!;
  }

  get(id: string): Watcher | null {
    const r = this.db.prepare("SELECT * FROM watchers WHERE id = ?").get(id);
    return r ? toWatcher(r) : null;
  }

  active(): Watcher[] {
    return (this.db.prepare("SELECT * FROM watchers WHERE stopped_at IS NULL ORDER BY created_at").all() as any[]).map(toWatcher);
  }

  checked(id: string, patch: { hash?: string; changed?: boolean; error?: string | null }) {
    const ts = now();
    this.db
      .prepare("UPDATE watchers SET last_checked_at = ?, last_hash = COALESCE(?, last_hash), last_changed_at = CASE WHEN ? THEN ? ELSE last_changed_at END, last_error = ? WHERE id = ?")
      .run(ts, patch.hash ?? null, patch.changed ? 1 : 0, ts, patch.error ?? null, id);
  }

  stop(id: string): boolean {
    return this.db.prepare("UPDATE watchers SET stopped_at = ? WHERE id = ? AND stopped_at IS NULL").run(now(), id).changes > 0;
  }
}
