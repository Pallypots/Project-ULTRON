import { useState } from "react";
import type { ToolEvent } from "@ultron/schemas";
import { api } from "./api.ts";

const ICON: Record<string, string> = { get_current_time: "🕒", create_reminder: "⏰", list_reminders: "📋", cancel_reminder: "🗑", open_website: "🌐", search_files: "🔎", read_file: "📄", open_on_screen: "🖥", connected_updates: "⛓", daily_briefing: "☀", github_create_issue: "🐙", calculate: "🧮", lookup_wikipedia: "📚", get_weather: "⛅", read_webpage: "📰", save_memory: "🧠", add_todo: "📝", list_todos: "📝", complete_todo: "✅", search_conversations: "💬", recall_everything_about_owner: "🧠", get_calendar: "📅", look_at_screen: "📸", web_search: "🔍", media_control: "🎵", open_app: "🚀", find_apps: "🚀", pc_status: "💻" };
// Approval-gated tools whose effect stays inside ULTRON (nothing leaves this computer).
const INTERNAL = new Set(["save_memory"]);
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
      const { action } = await (approve ? api.approveAction(e.executionId) : api.denyAction(e.executionId));
      // Update every view right away from the response; the live event stream is only a backup.
      window.dispatchEvent(new CustomEvent("ultron-action", { detail: action }));
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
      <span className="tool__summary">{e.summary}{e.status === "succeeded" && e.tool === "github_create_issue" ? " ✓ posted" : ""}</span>
      <span className="tool__status">{STATUS[e.status] ?? e.status}</span>
      {e.risk >= 2 && (INTERNAL.has(e.tool) ? <span className="tag tag--accent" title="Changes ULTRON's memory">memory</span> : <span className="tag tag--warn" title="Has an effect outside ULTRON">external</span>)}
      {e.preview && (waiting || e.status === "succeeded") && (
        <details className="tool__preview" open={waiting}>
          <summary>{INTERNAL.has(e.tool) ? (waiting ? "Exactly what will be saved" : "What was saved") : waiting ? "Exactly what will be posted" : "What was posted"}</summary>
          <pre>{e.preview}</pre>
        </details>
      )}
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
