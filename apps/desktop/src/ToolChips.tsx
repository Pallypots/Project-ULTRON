import { useState } from "react";
import type { ToolEvent } from "@ultron/schemas";
import { api } from "./api.ts";

const ICON: Record<string, string> = { get_current_time: "🕒", create_reminder: "⏰", list_reminders: "📋", cancel_reminder: "🗑", open_website: "🌐", search_files: "🔎", read_file: "📄", open_on_screen: "🖥", connected_updates: "⛓" };
const STATUS: Record<string, string> = {
  succeeded: "done",
  failed: "failed",
  denied: "not allowed",
  cancelled: "cancelled",
  expired: "expired",
  running: "running…",
  awaiting_approval: "needs your approval",
};

/** Shows what ULTRON did (or wants to do) for a message, with Approve / Deny for actions that need consent. */
export function ToolChips({ events }: { events: ToolEvent[] }) {
  return (
    <div className="tools">
      {events.map((e) => (
        <ToolChip key={e.executionId} e={e} />
      ))}
    </div>
  );
}

function ToolChip({ e }: { e: ToolEvent }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (approve: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await (approve ? api.approveAction(e.executionId) : api.denyAction(e.executionId));
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const waiting = e.status === "awaiting_approval";
  return (
    <div className={`tool tool--${e.status}`} role={waiting ? "group" : undefined} aria-label={waiting ? `Approval needed: ${e.summary}` : undefined}>
      <span aria-hidden="true">{ICON[e.tool] ?? "⚙"}</span>
      <span className="tool__summary">{e.summary}</span>
      <span className="tool__status">{STATUS[e.status] ?? e.status}</span>
      {e.risk >= 2 && <span className="tag tag--warn" title="Has an effect outside ULTRON">external</span>}
      {waiting && (
        <span className="row">
          <button type="button" className="btn btn--small btn--primary" disabled={busy} onClick={() => decide(true)}>Approve</button>
          <button type="button" className="btn btn--small" disabled={busy} onClick={() => decide(false)}>Deny</button>
        </span>
      )}
      {err && <span className="small" role="alert">{err}</span>}
    </div>
  );
}
