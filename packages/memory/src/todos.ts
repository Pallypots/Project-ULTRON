import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";

export interface Todo {
  id: string;
  text: string;
  /** Optional YYYY-MM-DD the owner mentioned ("by Friday"). */
  dueDate: string | null;
  doneAt: string | null;
  conversationId: string | null;
  createdAt: string;
}

const toTodo = (r: any): Todo => ({ id: r.id, text: r.text, dueDate: r.due_date, doneAt: r.done_at, conversationId: r.conversation_id, createdAt: r.created_at });

/** The owner's to-do list. Simple on purpose: text, optional due date, done or not. */
export class TodoStore {
  constructor(private db: Db) {}

  add(t: { text: string; dueDate?: string | null; conversationId?: string | null }): Todo {
    const id = uuid();
    this.db.prepare("INSERT INTO todos (id, text, due_date, conversation_id, created_at) VALUES (?, ?, ?, ?, ?)").run(id, t.text, t.dueDate ?? null, t.conversationId ?? null, now());
    return this.get(id)!;
  }

  get(id: string): Todo | null {
    const row = this.db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
    return row ? toTodo(row) : null;
  }

  /** Open items first (due ones earliest), then items finished in the last week. */
  list(opts: { includeDone?: boolean } = {}): Todo[] {
    const open = (this.db.prepare("SELECT * FROM todos WHERE done_at IS NULL ORDER BY due_date IS NULL, due_date, created_at").all() as any[]).map(toTodo);
    if (!opts.includeDone) return open;
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const done = (this.db.prepare("SELECT * FROM todos WHERE done_at IS NOT NULL AND done_at >= ? ORDER BY done_at DESC").all(weekAgo) as any[]).map(toTodo);
    return [...open, ...done];
  }

  setDone(id: string, done: boolean): Todo | null {
    this.db.prepare("UPDATE todos SET done_at = ? WHERE id = ?").run(done ? now() : null, id);
    return this.get(id);
  }

  update(id: string, patch: { text?: string; dueDate?: string | null }): Todo | null {
    const cur = this.get(id);
    if (!cur) return null;
    this.db.prepare("UPDATE todos SET text = ?, due_date = ? WHERE id = ?").run(patch.text ?? cur.text, patch.dueDate === undefined ? cur.dueDate : patch.dueDate, id);
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM todos WHERE id = ?").run(id).changes > 0;
  }

  /** Finds open items matching what the owner said ("the taxes" → "Do the taxes"). Best matches first. */
  match(query: string): Todo[] {
    const words = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !["the", "and", "for", "with", "that", "this", "item", "task", "todo", "list", "off", "done", "finished", "my"].includes(w));
    if (!words.length) return [];
    const stem = (w: string) => w.slice(0, Math.max(4, w.length - 2));
    return this.list()
      .map((t) => ({ t, score: words.filter((w) => t.text.toLowerCase().includes(stem(w))).length / words.length }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.t);
  }
}
