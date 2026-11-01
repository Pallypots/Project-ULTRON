import { useEffect, useState } from "react";
import { api, type Note } from "../api.ts";

/** Reminders page → Notes: what the owner dictated ("take a note: …"), newest first. */
export function NotesPanel({ refreshKey }: { refreshKey: number }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const load = () => api.notes().then((r) => setNotes(r.notes)).catch(() => {});
  useEffect(() => {
    load();
  }, [refreshKey]);
  if (!notes) return null;
  const shown = filter.trim() ? notes.filter((n) => n.text.toLowerCase().includes(filter.trim().toLowerCase())) : notes;
  return (
    <section className="panel" aria-labelledby="notes-title">
      <h2 className="panel__title" id="notes-title">Notes {notes.length ? `· ${notes.length}` : ""}</h2>
      <p className="muted small">Say "take a note: …" or "jot down …", or type one here. Ask "what did I note about …?" to find them.</p>
      <form className="ask" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await api.addNote(text.trim()); setText(""); load(); }}>
        <label className="sr-only" htmlFor="note-new">New note</label>
        <input id="note-new" value={text} onChange={(e) => setText(e.target.value)} placeholder="New note…" autoComplete="off" />
        <button className="btn btn--primary" type="submit" disabled={!text.trim()}>Add note</button>
      </form>
      {notes.length > 5 && (
        <label className="field" style={{ marginTop: 10 }}>
          <span className="sr-only">Filter notes</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter notes…" />
        </label>
      )}
      <ul className="reminders">
        {shown.map((n) => (
          <li key={n.id} className="reminder">
            <span>
              {n.text}
              <div className="small muted">{new Date(n.createdAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
            </span>
            <button className="icon-btn" aria-label={`Delete note: ${n.text.slice(0, 40)}`} onClick={async () => { await api.deleteNote(n.id); load(); }}>×</button>
          </li>
        ))}
        {!notes.length && <li className="muted small">No notes yet.</li>}
      </ul>
    </section>
  );
}
