import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";

export interface Note {
  id: string;
  text: string;
  conversationId: string | null;
  createdAt: string;
}

const toNote = (r: any): Note => ({ id: r.id, text: r.text, conversationId: r.conversation_id, createdAt: r.created_at });

/** Notes the owner dictates. Newest first. */
export class NoteStore {
  constructor(private db: Db) {}

  add(n: { text: string; conversationId?: string | null }): Note {
    const id = uuid();
    this.db.prepare("INSERT INTO notes (id, text, conversation_id, created_at) VALUES (?, ?, ?, ?)").run(id, n.text, n.conversationId ?? null, now());
    return this.get(id)!;
  }

  get(id: string): Note | null {
    const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
    return row ? toNote(row) : null;
  }

  list(limit = 200): Note[] {
    return (this.db.prepare("SELECT * FROM notes ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as any[]).map(toNote);
  }

  /** Notes containing any of the words (at least half of them), best matches first. */
  search(query: string, limit = 20): Note[] {
    const words = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !["the", "and", "about", "notes", "note", "my", "what", "did", "any"].includes(w));
    if (!words.length) return this.list(limit);
    return this.list(1000)
      .map((n) => ({ n, score: words.filter((w) => n.text.toLowerCase().includes(w.slice(0, Math.max(4, w.length - 2)))).length / words.length }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.n);
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM notes WHERE id = ?").run(id).changes > 0;
  }
}
