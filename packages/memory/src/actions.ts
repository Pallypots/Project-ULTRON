import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";

export type ExecutionStatus = "proposed" | "awaiting_approval" | "running" | "succeeded" | "failed" | "cancelled" | "denied" | "expired";

export interface ToolExecution {
  id: string;
  conversationId: string | null;
  tool: string;
  input: Record<string, unknown>;
  risk: number;
  status: ExecutionStatus;
  requestedBy: "model" | "owner" | "command";
  summary: string;
  result: string | null;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  finishedAt: string | null;
}

const toExec = (r: any): ToolExecution => ({
  id: r.id,
  conversationId: r.conversation_id,
  tool: r.tool,
  input: JSON.parse(r.input),
  risk: r.risk,
  status: r.status,
  requestedBy: r.requested_by,
  summary: r.summary,
  result: r.result,
  error: r.error,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  finishedAt: r.finished_at,
});

/** Every action ULTRON proposes or takes, with its state machine: proposed → (awaiting_approval →) running → succeeded/failed. */
export class ActionStore {
  constructor(private db: Db) {}

  create(e: { conversationId: string | null; tool: string; input: Record<string, unknown>; risk: number; requestedBy: ToolExecution["requestedBy"]; summary: string; status: ExecutionStatus }): ToolExecution {
    const id = uuid();
    this.db
      .prepare("INSERT INTO tool_executions (id, conversation_id, tool, input, risk, status, requested_by, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, e.conversationId, e.tool, JSON.stringify(e.input), e.risk, e.status, e.requestedBy, e.summary, now());
    return this.get(id)!;
  }

  get(id: string): ToolExecution | null {
    const row = this.db.prepare("SELECT * FROM tool_executions WHERE id = ?").get(id);
    return row ? toExec(row) : null;
  }

  update(id: string, patch: { status: ExecutionStatus; result?: string | null; error?: string | null }): ToolExecution | null {
    const decided = ["running", "denied", "expired", "cancelled"].includes(patch.status) ? now() : null;
    const finished = ["succeeded", "failed", "denied", "expired", "cancelled"].includes(patch.status) ? now() : null;
    this.db
      .prepare("UPDATE tool_executions SET status = ?, result = COALESCE(?, result), error = COALESCE(?, error), decided_at = COALESCE(decided_at, ?), finished_at = COALESCE(?, finished_at) WHERE id = ?")
      .run(patch.status, patch.result ?? null, patch.error ?? null, decided, finished, id);
    return this.get(id);
  }

  list(limit = 100): ToolExecution[] {
    return (this.db.prepare("SELECT * FROM tool_executions ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as any[]).map(toExec);
  }

  pending(): ToolExecution[] {
    return (this.db.prepare("SELECT * FROM tool_executions WHERE status = 'awaiting_approval' ORDER BY created_at ASC").all() as any[]).map(toExec);
  }

  /** Approvals are short-lived: anything waiting longer than maxAgeMs expires and can't be approved later. */
  expireStale(maxAgeMs: number, at = new Date()): number {
    const cutoff = new Date(at.getTime() - maxAgeMs).toISOString();
    return Number(this.db.prepare("UPDATE tool_executions SET status = 'expired', finished_at = ? WHERE status = 'awaiting_approval' AND created_at < ?").run(now(), cutoff).changes);
  }
}
