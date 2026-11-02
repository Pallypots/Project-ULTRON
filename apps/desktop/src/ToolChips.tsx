import { useState } from "react";
import { Icon, type IconName } from "./icons.tsx";
import type { ToolEvent } from "@ultron/schemas";
import { api } from "./api.ts";

const ICON: Record<string, IconName> = { get_current_time: "clock", create_reminder: "reminder", list_reminders: "list", cancel_reminder: "trash", open_website: "globe", search_files: "search", read_file: "file", open_on_screen: "monitor", connected_updates: "connections", daily_briefing: "sun", github_create_issue: "github", calculate: "calculator", lookup_wikipedia: "book", get_weather: "weather", read_webpage: "news", save_memory: "brain", add_todo: "todo", list_todos: "todo", complete_todo: "done", search_conversations: "conversations", recall_everything_about_owner: "brain", get_calendar: "calendar", look_at_screen: "screen", look_through_camera: "camera", privacy_shield: "shield", research: "research", watch_page: "eye", list_watchers: "eye", stop_watching: "eye", web_search: "search", media_control: "music", open_app: "launch", find_apps: "launch", pc_status: "pc", home_control: "light", home_devices: "light", home_cover_or_script: "door", check_email: "mail", read_email: "mail", add_note: "note", list_notes: "note", get_news: "news", read_clipboard: "clipboard", convert_units: "calculator", convert_currency: "calculator", define_word: "book", world_time: "clock" };
// Approval-gated tools whose effect stays inside ULTRON (nothing leaves this computer).
const INTERNAL = new Set(["save_memory"]);
// After approval, ULTRON carries on with the result instead of stopping at the approval card.
const FOLLOW_UP = new Set(["read_webpage"]);
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
      // Some approved actions produce something the brain needs to finish its answer (e.g. a page it wanted to read).
      if (approve && action.status === "succeeded" && FOLLOW_UP.has(action.tool)) window.dispatchEvent(new CustomEvent("ultron-continue", { detail: action }));
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const waiting = e.status === "awaiting_approval";
  return (
    <div className={`tool tool--${e.status}`} role={waiting ? "group" : undefined} aria-label={waiting ? `Approval needed: ${e.summary}` : undefined}>
      <Icon name={ICON[e.tool] ?? "settings"} className="tool__icon" />
      <span className="tool__summary">{e.summary}{e.status === "succeeded" && e.tool === "github_create_issue" ? " (posted)" : ""}</span>
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
