import { useEffect, useState } from "react";
import type { AuditEvent } from "@ultron/schemas";
import { api, type ActionRecord } from "../api.ts";
import { ToolChips } from "../ToolChips.tsx";

const DESCRIBE: Record<string, string> = {
  "memory.created": "Memory saved",
  "memory.updated": "Memory edited",
  "memory.deleted": "Memory forgotten",
  "memory.blocked": "Refused to store sensitive data",
  "memory.exported": "Memories exported",
  "conversation.deleted": "Conversation deleted",
  "settings.provider_changed": "Model settings changed",
  "settings.key_removed": "API key removed",
  "system.stop_all": "Emergency stop used",
  "model.error": "Model error",
  "voice.transcribed": "Microphone used (push-to-talk)",
  "voice.error": "Speech recognition error",
  "settings.voice_changed": "Voice settings changed",
  "settings.tts_changed": "Spoken-reply settings changed",
  "settings.brain_switched": "Brain switched",
  "action.started": "Action started",
  "action.succeeded": "Action completed",
  "action.failed": "Action failed",
  "action.awaiting_approval": "Action waiting for approval",
  "action.approved": "Action approved by you",
  "action.denied": "Action denied",
  "actions.paused": "Actions paused",
  "actions.policy_changed": "Action rules changed",
  "reminder.created": "Reminder added",
  "reminder.cancelled": "Reminder cancelled",
  "reminder.fired": "Reminder fired",
  "reminders.missed_while_offline": "Reminders missed while ULTRON was off",
  "local_ai.download_started": "Local model download started",
  "recovery.interrupted_messages": "Recovered interrupted replies after restart",
};

const RISK = ["read-only", "low-risk", "external", "high-risk"];

export function ActivityView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [pending, setPending] = useState<ActionRecord[]>([]);
  const load = () => {
    api.activity().then((r) => setEvents(r.events)).catch(() => {});
    api.actions().then((r) => { setActions(r.actions); setPending(r.pending); }).catch(() => {});
  };
  useEffect(() => {
    load();
    window.addEventListener("ultron-action", load);
    return () => window.removeEventListener("ultron-action", load);
  }, []);

  const downloadLogs = async () => {
    const text = await api.logs();
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ultron-logs.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Activity</h1>
          <p className="muted">An audit trail of what changed and who did it. Secrets are always redacted.</p>
        </div>
        <button className="btn" onClick={downloadLogs}>Export logs (redacted)</button>
      </header>
      {pending.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">Waiting for your approval</h2>
          <p className="muted small">ULTRON proposed these. Nothing happens unless you approve. Requests expire after 10 minutes.</p>
          <ToolChips events={pending.map((a) => ({ executionId: a.id, tool: a.tool, summary: a.summary, status: a.status, risk: a.risk }))} />
        </section>
      )}

      <h2 className="panel__title">Actions</h2>
      {actions.length === 0 ? (
        <p className="empty">ULTRON hasn't taken any actions yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>When</th><th>Action</th><th>Risk</th><th>Asked by</th><th>Result</th></tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
                <td>{a.summary}</td>
                <td>{RISK[a.risk] ?? a.risk}</td>
                <td>{a.requestedBy === "model" ? "ULTRON" : a.requestedBy === "command" ? "you (command)" : "you"}</td>
                <td className={a.status === "succeeded" ? "" : "muted"}>{a.status.replace("_", " ")}{a.error ? `: ${a.error}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="panel__title">Audit log</h2>
      {events.length === 0 ? (
        <p className="empty">No activity yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>When</th><th>What</th><th>By</th><th>Details</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{DESCRIBE[e.action] ?? e.action}</td>
                <td>{e.actor}</td>
                <td className="mono small">{Object.keys(e.detail).length ? JSON.stringify(e.detail) : e.target ? e.target.slice(0, 8) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
