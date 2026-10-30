import type { AuditEvent } from "@ultron/schemas";
import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";

const SECRET_KEY = /(api[_-]?key|token|secret|password|authorization|cookie)/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|xox[abp]-[A-Za-z0-9-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{8,})/g;

/** Removes anything that looks like a credential before it is written to logs or the audit trail. */
export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[REDACTED]" : redact(v)]),
    );
  }
  return value;
}

export class AuditLog {
  constructor(private db: Db) {}

  record(action: string, actor: string, target: string | null = null, detail: Record<string, unknown> = {}): void {
    this.db
      .prepare("INSERT INTO audit_events (id, action, actor, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(uuid(), action, actor, target, JSON.stringify(redact(detail)), now());
  }

  list(limit = 200): AuditEvent[] {
    return (this.db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as any[]).map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor,
      target: r.target,
      detail: JSON.parse(r.detail),
      createdAt: r.created_at,
    }));
  }
}
