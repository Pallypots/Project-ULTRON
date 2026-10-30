import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";

/** Canonical event schema shared by every connector (blueprint §17.1). */
export interface ConnectorEvent {
  id: string;
  source: string;
  providerEventId: string;
  accountId: string | null;
  resourceType: string;
  resourceId: string;
  title: string;
  summary: string;
  canonicalUrl: string | null;
  occurredAt: string;
  observedAt: string;
  projectTags: string[];
  urgency: number;
  readState: "unread" | "read" | "saved";
  /** Plain-English reason ULTRON surfaced this (audit trail for "why am I seeing this?"). */
  why: string;
  contentExpiry: string | null;
  dedupeKey: string;
}

export interface IntegrationRow {
  id: string;
  account: string | null;
  config: Record<string, unknown>;
  cursor: Record<string, unknown>;
  health: "not_connected" | "ok" | "error" | "rate_limited" | "syncing";
  healthDetail: string;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  connectedAt: string | null;
}

const toEvent = (r: any): ConnectorEvent => ({
  id: r.id,
  source: r.source,
  providerEventId: r.provider_event_id,
  accountId: r.account_id,
  resourceType: r.resource_type,
  resourceId: r.resource_id,
  title: r.title,
  summary: r.summary,
  canonicalUrl: r.canonical_url,
  occurredAt: r.occurred_at,
  observedAt: r.observed_at,
  projectTags: JSON.parse(r.project_tags),
  urgency: r.urgency,
  readState: r.read_state,
  why: r.why,
  contentExpiry: r.content_expiry,
  dedupeKey: r.dedupe_key,
});

const toIntegration = (r: any): IntegrationRow => ({
  id: r.id,
  account: r.account,
  config: JSON.parse(r.config),
  cursor: JSON.parse(r.cursor),
  health: r.health,
  healthDetail: r.health_detail,
  lastSyncAt: r.last_sync_at,
  nextSyncAt: r.next_sync_at,
  connectedAt: r.connected_at,
});

export type NewConnectorEvent = Omit<ConnectorEvent, "id" | "observedAt" | "readState">;

export class ConnectorStore {
  constructor(private db: Db) {}

  integration(id: string): IntegrationRow | null {
    const r = this.db.prepare("SELECT * FROM integrations WHERE id = ?").get(id);
    return r ? toIntegration(r) : null;
  }

  saveIntegration(id: string, patch: Partial<Omit<IntegrationRow, "id">>) {
    const cur = this.integration(id);
    const next = { account: null, config: {}, cursor: {}, health: "not_connected", healthDetail: "", lastSyncAt: null, nextSyncAt: null, connectedAt: null, ...cur, ...patch };
    this.db
      .prepare(
        `INSERT INTO integrations (id, account, config, cursor, health, health_detail, last_sync_at, next_sync_at, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET account = excluded.account, config = excluded.config, cursor = excluded.cursor, health = excluded.health,
         health_detail = excluded.health_detail, last_sync_at = excluded.last_sync_at, next_sync_at = excluded.next_sync_at, connected_at = excluded.connected_at`,
      )
      .run(id, next.account, JSON.stringify(next.config), JSON.stringify(next.cursor), next.health, next.healthDetail, next.lastSyncAt, next.nextSyncAt, next.connectedAt);
    return this.integration(id)!;
  }

  /** Disconnecting deletes the integration row and every event it produced. */
  removeIntegration(id: string): number {
    this.db.prepare("DELETE FROM integrations WHERE id = ?").run(id);
    return Number(this.db.prepare("DELETE FROM connector_events WHERE source = ?").run(id).changes);
  }

  /** Inserts new events; duplicates (same dedupe key) are ignored. Returns how many were new. */
  addEvents(events: NewConnectorEvent[]): number {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO connector_events (id, source, provider_event_id, account_id, resource_type, resource_id, title, summary, canonical_url,
       occurred_at, observed_at, project_tags, urgency, why, content_expiry, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let added = 0;
    this.db.exec("BEGIN");
    try {
      for (const e of events) {
        added += Number(
          stmt.run(uuid(), e.source, e.providerEventId, e.accountId, e.resourceType, e.resourceId, e.title.slice(0, 300), e.summary.slice(0, 500), e.canonicalUrl, e.occurredAt, now(), JSON.stringify(e.projectTags), e.urgency, e.why, e.contentExpiry, e.dedupeKey).changes,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return added;
  }

  events(opts: { source?: string; sinceIso?: string; unreadOnly?: boolean; minUrgency?: number; limit?: number } = {}): ConnectorEvent[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.source) where.push("source = ?"), args.push(opts.source);
    if (opts.sinceIso) where.push("occurred_at >= ?"), args.push(opts.sinceIso);
    if (opts.unreadOnly) where.push("read_state = 'unread'");
    if (opts.minUrgency !== undefined) where.push("urgency >= ?"), args.push(opts.minUrgency);
    const sql = `SELECT * FROM connector_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY occurred_at DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...args, opts.limit ?? 100) as any[]).map(toEvent);
  }

  markRead(ids: string[] | "all", source?: string) {
    if (ids === "all") this.db.prepare(`UPDATE connector_events SET read_state = 'read' WHERE read_state = 'unread'${source ? " AND source = ?" : ""}`).run(...(source ? [source] : []));
    else for (const id of ids) this.db.prepare("UPDATE connector_events SET read_state = 'read' WHERE id = ? AND read_state = 'unread'").run(id);
  }

  /** Data minimisation: drop events past their retention date. */
  purgeExpired(at = new Date()): number {
    return Number(this.db.prepare("DELETE FROM connector_events WHERE content_expiry IS NOT NULL AND content_expiry < ?").run(at.toISOString()).changes);
  }
}
