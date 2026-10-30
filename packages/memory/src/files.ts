import type { Db } from "./db.ts";
import { toFtsQuery } from "./memories.ts";
import { now, uuid } from "./util.ts";

export interface Folder {
  id: string;
  path: string;
  status: "pending" | "indexing" | "ready" | "error";
  detail: string;
  fileCount: number;
  addedAt: string;
  indexedAt: string | null;
}

export interface FileHit {
  docId: string;
  path: string;
  name: string;
  ext: string;
  size: number;
  modified: string;
  snippet: string;
}

const toFolder = (r: any): Folder => ({ id: r.id, path: r.path, status: r.status, detail: r.detail, fileCount: r.file_count, addedAt: r.added_at, indexedAt: r.indexed_at });

/** The local file index: which folders the owner approved, what's in them, and full-text search over names and contents. */
export class FileIndexStore {
  constructor(private db: Db) {}

  addFolder(path: string): Folder {
    const id = uuid();
    this.db.prepare("INSERT INTO folders (id, path, added_at) VALUES (?, ?, ?)").run(id, path, now());
    return this.folder(id)!;
  }

  folder(id: string): Folder | null {
    const r = this.db.prepare("SELECT * FROM folders WHERE id = ?").get(id);
    return r ? toFolder(r) : null;
  }

  folders(): Folder[] {
    return (this.db.prepare("SELECT * FROM folders ORDER BY added_at").all() as any[]).map(toFolder);
  }

  setFolderStatus(id: string, status: Folder["status"], detail = "", fileCount?: number) {
    this.db
      .prepare("UPDATE folders SET status = ?, detail = ?, file_count = COALESCE(?, file_count), indexed_at = CASE WHEN ? = 'ready' THEN ? ELSE indexed_at END WHERE id = ?")
      .run(status, detail, fileCount ?? null, status, now(), id);
  }

  /** Removing a folder deletes its whole index (rows and search entries). */
  removeFolder(id: string): boolean {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM document_chunks WHERE doc_id IN (SELECT id FROM documents WHERE folder_id = ?)").run(id);
      const n = this.db.prepare("DELETE FROM folders WHERE id = ?").run(id).changes;
      this.db.exec("COMMIT");
      return n > 0;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Existing documents in a folder keyed by path, for incremental re-indexing. */
  docsByPath(folderId: string): Map<string, { id: string; mtimeMs: number; size: number }> {
    const rows = this.db.prepare("SELECT id, path, mtime_ms, size FROM documents WHERE folder_id = ?").all(folderId) as any[];
    return new Map(rows.map((r) => [r.path, { id: r.id, mtimeMs: r.mtime_ms, size: r.size }]));
  }

  upsertDoc(d: { folderId: string; path: string; name: string; ext: string; size: number; mtimeMs: number; chunks: string[] | null }, existingId?: string) {
    this.db.exec("BEGIN");
    try {
      const id = existingId ?? uuid();
      if (existingId) {
        this.db.prepare("UPDATE documents SET size = ?, mtime_ms = ?, content_indexed = ? WHERE id = ?").run(d.size, d.mtimeMs, d.chunks ? 1 : 0, id);
        this.db.prepare("DELETE FROM document_chunks WHERE doc_id = ?").run(id);
      } else {
        this.db.prepare("INSERT INTO documents (id, folder_id, path, name, ext, size, mtime_ms, content_indexed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, d.folderId, d.path, d.name, d.ext, d.size, d.mtimeMs, d.chunks ? 1 : 0);
      }
      const insert = this.db.prepare("INSERT INTO document_chunks (name, content, doc_id, chunk) VALUES (?, ?, ?, ?)");
      const chunks = d.chunks?.length ? d.chunks : [""];
      chunks.forEach((c, i) => insert.run(i === 0 ? `${d.name} ${d.path}` : "", c, id, i));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  removeDocs(ids: string[]) {
    const delChunks = this.db.prepare("DELETE FROM document_chunks WHERE doc_id = ?");
    const delDoc = this.db.prepare("DELETE FROM documents WHERE id = ?");
    for (const id of ids) {
      delChunks.run(id);
      delDoc.run(id);
    }
  }

  doc(id: string): { id: string; path: string; name: string; folderId: string } | null {
    const r = this.db.prepare("SELECT id, path, name, folder_id FROM documents WHERE id = ?").get(id) as any;
    return r ? { id: r.id, path: r.path, name: r.name, folderId: r.folder_id } : null;
  }

  /** Best-matching files; names count more than contents. One hit per file. */
  search(query: string, limit = 10): FileHit[] {
    const q = toFtsQuery(query);
    if (!q) return [];
    const rows = this.db
      .prepare(
        `SELECT d.id, d.path, d.name, d.ext, d.size, d.mtime_ms, snippet(document_chunks, 1, '«', '»', ' … ', 18) AS snip, bm25(document_chunks, 4.0, 1.0) AS score
         FROM document_chunks c JOIN documents d ON d.id = c.doc_id
         WHERE document_chunks MATCH ? ORDER BY score LIMIT ?`,
      )
      .all(q, limit * 4) as any[];
    const seen = new Set<string>();
    const out: FileHit[] = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ docId: r.id, path: r.path, name: r.name, ext: r.ext, size: r.size, modified: new Date(r.mtime_ms).toISOString(), snippet: r.snip ?? "" });
      if (out.length >= limit) break;
    }
    return out;
  }
}
