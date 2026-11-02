import type { Memory, MemoryKind, MemoryPatch, Sensitivity } from "@ultron/schemas";
import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  content: string;
  source: Memory["source"];
  source_conversation_id: string | null;
  source_message_id: string | null;
  confirmed: number;
  pinned: number;
  confidence: number;
  sensitivity: Sensitivity;
  review_at: string | null;
  created_at: string;
  updated_at: string;
}

const toMemory = (r: MemoryRow): Memory => ({
  id: r.id,
  kind: r.kind,
  content: r.content,
  source: r.source,
  sourceConversationId: r.source_conversation_id,
  sourceMessageId: r.source_message_id,
  confirmed: r.confirmed === 1,
  pinned: r.pinned === 1,
  confidence: r.confidence,
  sensitivity: r.sensitivity,
  reviewAt: r.review_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const STOPWORDS = new Set(
  "a an the and or but if of to in on at for with by from is are was were be been am do does did i me my mine you your we our it its this that these those what which who whom when where why how can could would should will shall about into than then there here have has had not no yes so as just also please ultron remember tell know".split(" "),
);

/** Turns free text into a safe FTS5 OR-query of meaningful words (no user-controlled FTS syntax). */
export function toFtsQuery(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const unique = [...new Set(words)].slice(0, 24);
  return unique.length ? unique.map((w) => `"${w}"`).join(" OR ") : null;
}

export interface NewMemory {
  content: string;
  kind: MemoryKind;
  source: Memory["source"];
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  pinned?: boolean;
  sensitivity?: Sensitivity;
  confidence?: number;
}

export class MemoryStore {
  constructor(private db: Db) {}

  create(m: NewMemory): Memory {
    const id = uuid();
    const ts = now();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO memories (id, kind, content, source, source_conversation_id, source_message_id, confirmed, pinned, confidence, sensitivity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(id, m.kind, m.content, m.source, m.sourceConversationId ?? null, m.sourceMessageId ?? null, m.pinned ? 1 : 0, m.confidence ?? 1, m.sensitivity ?? "normal", ts, ts);
      this.db.prepare("INSERT INTO memories_fts (content, memory_id) VALUES (?, ?)").run(m.content, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.get(id)!;
  }

  get(id: string): Memory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as unknown as MemoryRow | undefined;
    return row ? toMemory(row) : null;
  }

  /** How many there are, without loading them (status is polled every few seconds). */
  count(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }).n);
  }

  list(): Memory[] {
    return (this.db.prepare("SELECT * FROM memories ORDER BY pinned DESC, updated_at DESC").all() as unknown as MemoryRow[]).map(toMemory);
  }

  update(id: string, patch: MemoryPatch): Memory | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("UPDATE memories SET content = ?, kind = ?, pinned = ?, sensitivity = ?, updated_at = ? WHERE id = ?")
        .run(next.content, next.kind, next.pinned ? 1 : 0, next.sensitivity, now(), id);
      if (patch.content !== undefined) {
        this.db.prepare("DELETE FROM memories_fts WHERE memory_id = ?").run(id);
        this.db.prepare("INSERT INTO memories_fts (content, memory_id) VALUES (?, ?)").run(next.content, id);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.get(id);
  }

  /** Hard delete: the record and its search index entry are gone, so it can never be retrieved again. */
  delete(id: string): boolean {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM memories_fts WHERE memory_id = ?").run(id);
      const changes = this.db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes;
      this.db.exec("COMMIT");
      return changes > 0;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Ranked keyword retrieval (BM25). Embedding search can be layered on behind this same method later. */
  search(text: string, limit = 5): Memory[] {
    const q = toFtsQuery(text);
    if (!q) return [];
    const rows = this.db
      .prepare(
        `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT ?`,
      )
      .all(q, limit) as unknown as MemoryRow[];
    return rows.map(toMemory);
  }

  // ---- vectors for meaning-based recall ----
  setVector(memoryId: string, model: string, contentHash: string, vector: Float32Array) {
    this.db
      .prepare("INSERT INTO memory_vectors (memory_id, model, content_hash, vector) VALUES (?, ?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET model = excluded.model, content_hash = excluded.content_hash, vector = excluded.vector")
      .run(memoryId, model, contentHash, new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
  }

  /** Memories whose vector is missing or stale (content or model changed). */
  needingVectors(model: string, hash: (s: string) => string): Memory[] {
    const rows = this.db.prepare("SELECT m.*, v.model AS vmodel, v.content_hash AS vhash FROM memories m LEFT JOIN memory_vectors v ON v.memory_id = m.id").all() as any[];
    return rows.filter((r) => r.vmodel !== model || r.vhash !== hash(r.content)).map(toMemory);
  }

  /** Cosine similarity against every memory (fine for thousands of memories; vectors are normalised). */
  nearest(query: Float32Array, model: string, limit = 6, minScore = 0.4): { memory: Memory; score: number }[] {
    const rows = this.db.prepare("SELECT m.*, v.vector AS vec FROM memory_vectors v JOIN memories m ON m.id = v.memory_id WHERE v.model = ?").all(model) as any[];
    const scored = rows.map((r) => {
      const u8 = r.vec as Uint8Array;
      const v = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
      let dot = 0;
      for (let i = 0; i < v.length && i < query.length; i++) dot += v[i]! * query[i]!;
      return { memory: toMemory(r), score: dot };
    });
    return scored.filter((s) => s.score >= minScore).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Hybrid recall: pinned first, then keyword (BM25) and meaning (vector) results merged by reciprocal rank. */
  retrieveHybrid(text: string, semantic: { memory: Memory; score: number }[], limit = 6): Memory[] {
    const scores = new Map<string, { m: Memory; s: number }>();
    const add = (list: Memory[], weight: number) =>
      list.forEach((m, rank) => {
        const cur = scores.get(m.id) ?? { m, s: 0 };
        cur.s += weight / (60 + rank);
        scores.set(m.id, cur);
      });
    add(this.search(text, limit * 2), 1);
    add(semantic.map((x) => x.memory), 1);
    const ranked = [...scores.values()].sort((a, b) => b.s - a.s).map((x) => x.m);
    const seen = new Map<string, Memory>();
    for (const m of [...this.pinned(3), ...ranked]) if (!seen.has(m.id)) seen.set(m.id, m);
    return [...seen.values()].slice(0, limit);
  }

  pinned(limit = 5): Memory[] {
    return (this.db.prepare("SELECT * FROM memories WHERE pinned = 1 ORDER BY updated_at DESC LIMIT ?").all(limit) as unknown as MemoryRow[]).map(toMemory);
  }

  /** Memories to place in the prompt for this user turn: pinned first, then the best matches. */
  retrieveForPrompt(text: string, limit = 6): Memory[] {
    const seen = new Map<string, Memory>();
    for (const m of [...this.pinned(3), ...this.search(text, limit)]) if (!seen.has(m.id)) seen.set(m.id, m);
    return [...seen.values()].slice(0, limit);
  }
}
