import type { Conversation, InputMode, Message, MessageStatus, Role } from "@ultron/schemas";
import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";
import { toFtsQuery } from "./memories.ts";

export interface ConversationHit {
  conversationId: string;
  title: string;
  role: Role;
  createdAt: string;
  snippet: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  status: MessageStatus;
  provider: string | null;
  model: string | null;
  memory_ids: string;
  source_device_id: string | null;
  input_mode: InputMode;
  tool_events: string;
  created_at: string;
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  status: r.status,
  provider: r.provider,
  model: r.model,
  memoryIds: JSON.parse(r.memory_ids) as string[],
  sourceDeviceId: r.source_device_id,
  inputMode: r.input_mode,
  toolEvents: JSON.parse(r.tool_events ?? "[]"),
  createdAt: r.created_at,
});

const toConversation = (r: { id: string; title: string; created_at: string; updated_at: string; summary?: string | null }): Conversation => ({
  id: r.id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  summary: r.summary ?? null,
});

export class ConversationStore {
  constructor(private db: Db) {}

  create(title = "New conversation"): Conversation {
    const ts = now();
    const id = uuid();
    this.db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, title, ts, ts);
    return { id, title, createdAt: ts, updatedAt: ts };
  }

  /** How many there are, without loading them (status is polled every few seconds). */
  count(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n);
  }

  list(): Conversation[] {
    return (this.db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all() as any[]).map(toConversation);
  }

  get(id: string): Conversation | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as any;
    return row ? toConversation(row) : null;
  }

  rename(id: string, title: string): void {
    this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, now(), id);
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id).changes > 0;
  }

  /** Removes the last thing the owner said and everything after it; returns what they said (for "try again"). */
  popLastExchange(conversationId: string): Message | null {
    const msgs = this.messages(conversationId);
    const i = msgs.map((m) => m.role).lastIndexOf("user");
    if (i < 0) return null;
    const del = this.db.prepare("DELETE FROM messages WHERE id = ?");
    for (const m of msgs.slice(i)) del.run(m.id);
    return msgs[i]!;
  }

  messages(conversationId: string, limit = 500): Message[] {
    const rows = this.db
      // rowid breaks ties: a user message and its reply placeholder are often written in the same millisecond.
      .prepare("SELECT * FROM (SELECT *, rowid AS seq FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at ASC, seq ASC")
      .all(conversationId, limit) as unknown as MessageRow[];
    return rows.map(toMessage);
  }

  addMessage(m: {
    conversationId: string;
    role: Role;
    content: string;
    status?: MessageStatus;
    provider?: string | null;
    model?: string | null;
    memoryIds?: string[];
    sourceDeviceId?: string | null;
    inputMode?: InputMode;
    id?: string;
  }): Message {
    const id = m.id ?? uuid();
    const ts = now();
    this.db
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content, status, provider, model, memory_ids, source_device_id, input_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, m.conversationId, m.role, m.content, m.status ?? "complete", m.provider ?? null, m.model ?? null, JSON.stringify(m.memoryIds ?? []), m.sourceDeviceId ?? null, m.inputMode ?? "text", ts);
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(ts, m.conversationId);
    return this.getMessage(id)!;
  }

  updateMessage(id: string, patch: { content?: string; status?: MessageStatus; memoryIds?: string[]; toolEvents?: Message["toolEvents"] }): Message | null {
    const cur = this.getMessage(id);
    if (!cur) return null;
    this.db
      .prepare("UPDATE messages SET content = ?, status = ?, memory_ids = ?, tool_events = ? WHERE id = ?")
      .run(patch.content ?? cur.content, patch.status ?? cur.status, JSON.stringify(patch.memoryIds ?? cur.memoryIds), JSON.stringify(patch.toolEvents ?? cur.toolEvents), id);
    return this.getMessage(id);
  }

  getMessage(id: string): Message | null {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as unknown as MessageRow | undefined;
    return row ? toMessage(row) : null;
  }

  /** Messages left mid-stream by a crash are marked as interrupted on startup. */
  recoverInterrupted(): number {
    return Number(
      this.db.prepare("UPDATE messages SET status = 'cancelled', content = content || ' [interrupted]' WHERE status = 'streaming'").run().changes,
    );
  }

  /** Full-text search over past messages (best matches first), optionally excluding one conversation and limited to recent days. */
  search(text: string, opts: { limit?: number; excludeConversationId?: string | null; sinceIso?: string } = {}): ConversationHit[] {
    const q = toFtsQuery(text);
    if (!q) return [];
    const rows = this.db
      .prepare(
        `SELECT m.conversation_id, c.title, m.role, m.created_at, snippet(messages_fts, 0, '«', '»', '…', 16) AS snippet
         FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid JOIN conversations c ON c.id = m.conversation_id
         WHERE messages_fts MATCH ? AND m.role IN ('user', 'assistant') AND m.status != 'error' AND m.conversation_id != ? AND m.created_at >= ?
         ORDER BY bm25(messages_fts) LIMIT ?`,
      )
      .all(q, opts.excludeConversationId ?? "", opts.sinceIso ?? "", opts.limit ?? 8) as any[];
    return rows.map((r) => ({ conversationId: r.conversation_id, title: r.title, role: r.role, createdAt: r.created_at, snippet: r.snippet }));
  }

  /** Stores ULTRON's note about a conversation. Doesn't touch updated_at (that tracks the owner's activity). */
  setSummary(id: string, summary: string): void {
    this.db.prepare("UPDATE conversations SET summary = ?, summarized_at = ? WHERE id = ?").run(summary, now(), id);
  }

  /** Conversations quiet since before `idleBefore`, with new messages since their last summary, oldest first. */
  needingSummary(idleBefore: string, minMessages = 4, limit = 3): Conversation[] {
    return (
      this.db
        .prepare(
          `SELECT c.* FROM conversations c
           WHERE c.updated_at < ? AND (c.summarized_at IS NULL OR c.summarized_at < c.updated_at)
             AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.status = 'complete') >= ?
           ORDER BY c.updated_at ASC LIMIT ?`,
        )
        .all(idleBefore, minMessages, limit) as any[]
    ).map(toConversation);
  }
}
