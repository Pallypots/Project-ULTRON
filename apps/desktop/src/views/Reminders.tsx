import { useEffect, useState } from "react";
import { api, type Reminder } from "../api.ts";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function countdown(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "now";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "in under a minute";
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `in ${h} h ${m % 60} min` : `in ${Math.round(h / 24)} days`;
}
const defaultDue = () => {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function RemindersView({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<Reminder[]>([]);
  const [text, setText] = useState("");
  const [due, setDue] = useState(defaultDue);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = () => api.reminders().then((r) => setItems(r.reminders)).catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, [refreshKey]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createReminder(text.trim(), new Date(due).toISOString());
      setText("");
      setDue(defaultDue());
      load();
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const upcoming = items.filter((r) => r.status === "scheduled");
  const missed = items.filter((r) => r.status === "missed");
  const past = items.filter((r) => r.status === "fired" || r.status === "cancelled").slice(-15).reverse();

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Reminders</h1>
          <p className="muted">
            Say "remind me in 20 minutes to…", "remind me at 5pm to…" or "set a timer for 10 minutes", or add one here. Reminders pop up, show a Windows
            notification and are spoken aloud. They only fire while ULTRON is running; anything missed while it was off is shown below.
          </p>
        </div>
      </header>

      <form className="panel add-memory" onSubmit={add}>
        <label htmlFor="rem-text" className="sr-only">Reminder</label>
        <input id="rem-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="What should I remind you about?" required />
        <label htmlFor="rem-due" className="sr-only">When</label>
        <input id="rem-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={{ maxWidth: 230 }} required />
        <button className="btn btn--primary" type="submit">Add</button>
      </form>
      {error && <div className="banner banner--error" role="alert">{error}</div>}

      {missed.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">Missed while ULTRON was off</h2>
          <ul className="reminders">
            {missed.map((r) => (
              <li key={r.id} className="reminder reminder--missed">
                <span>⚠ {r.text}</span>
                <span className="muted small">was due {when(r.dueAt)}</span>
                <button type="button" className="btn btn--small" onClick={() => api.cancelReminder(r.id).then(load)}>Dismiss</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="empty">Nothing scheduled.</p>
        ) : (
          <ul className="reminders">
            {upcoming.map((r) => (
              <li key={r.id} className="reminder">
                <span>⏰ {r.text}</span>
                <span className="muted small">{when(r.dueAt)} · {countdown(r.dueAt, now)}</span>
                <button type="button" className="btn btn--small btn--danger" onClick={() => api.cancelReminder(r.id).then(load)}>Cancel</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">Recent</h2>
          <ul className="reminders">
            {past.map((r) => (
              <li key={r.id} className="reminder reminder--past">
                <span>{r.status === "fired" ? "✓" : "✕"} {r.text}</span>
                <span className="muted small">{r.status === "fired" ? `fired ${when(r.firedAt ?? r.dueAt)}` : "cancelled"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
