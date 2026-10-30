import { useEffect, useState } from "react";
import type { AuditEvent } from "@ultron/schemas";
import { api } from "../api.ts";

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
  "local_ai.download_started": "Local model download started",
  "recovery.interrupted_messages": "Recovered interrupted replies after restart",
};

export function ActivityView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => {
    api.activity().then((r) => setEvents(r.events)).catch(() => {});
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
