import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";

export interface Reminder {
  id: string;
  text: string;
  dueAt: string;
  status: "scheduled" | "fired" | "missed" | "cancelled";
  source: "chat" | "tool" | "manual";
  conversationId: string | null;
  createdAt: string;
  firedAt: string | null;
}

const toReminder = (r: any): Reminder => ({
  id: r.id,
  text: r.text,
  dueAt: r.due_at,
  status: r.status,
  source: r.source,
  conversationId: r.conversation_id,
  createdAt: r.created_at,
  firedAt: r.fired_at,
});

export class ReminderStore {
  constructor(private db: Db) {}

  create(r: { text: string; dueAt: Date; source: Reminder["source"]; conversationId?: string | null }): Reminder {
    const id = uuid();
    this.db
      .prepare("INSERT INTO reminders (id, text, due_at, status, source, conversation_id, created_at) VALUES (?, ?, ?, 'scheduled', ?, ?, ?)")
      .run(id, r.text, r.dueAt.toISOString(), r.source, r.conversationId ?? null, now());
    return this.get(id)!;
  }

  get(id: string): Reminder | null {
    const row = this.db.prepare("SELECT * FROM reminders WHERE id = ?").get(id);
    return row ? toReminder(row) : null;
  }

  list(): Reminder[] {
    return (this.db.prepare("SELECT * FROM reminders ORDER BY CASE status WHEN 'scheduled' THEN 0 WHEN 'missed' THEN 1 ELSE 2 END, due_at ASC").all() as any[]).map(toReminder);
  }

  upcoming(): Reminder[] {
    return (this.db.prepare("SELECT * FROM reminders WHERE status = 'scheduled' ORDER BY due_at ASC").all() as any[]).map(toReminder);
  }

  due(at = new Date()): Reminder[] {
    return (this.db.prepare("SELECT * FROM reminders WHERE status = 'scheduled' AND due_at <= ? ORDER BY due_at ASC").all(at.toISOString()) as any[]).map(toReminder);
  }

  setStatus(id: string, status: Reminder["status"]): Reminder | null {
    this.db.prepare("UPDATE reminders SET status = ?, fired_at = CASE WHEN ? IN ('fired','missed') THEN ? ELSE fired_at END WHERE id = ?").run(status, status, now(), id);
    return this.get(id);
  }

  /** Reminders whose time passed while ULTRON wasn't running become "missed" (never silently dropped). */
  markMissed(graceMs: number, at = new Date()): Reminder[] {
    const cutoff = new Date(at.getTime() - graceMs).toISOString();
    const missed = (this.db.prepare("SELECT * FROM reminders WHERE status = 'scheduled' AND due_at < ?").all(cutoff) as any[]).map(toReminder);
    for (const r of missed) this.setStatus(r.id, "missed");
    return missed.map((r) => this.get(r.id)!);
  }
}
