import { useEffect, useState } from "react";
import { api, onThisPc } from "../api.ts";

/** Connections → Calendar: read-only, through the calendar's private iCal link (stored encrypted, never shown again). */
export function CalendarPanel({ onAsk }: { onAsk: (q: string) => void }) {
  const [s, setS] = useState<{ connected: boolean; lastSyncAt: string | null; error: string | null } | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api.calendar().then((r) => setS(r.calendar)).catch(() => {});
  }, []);
  if (!s) return null;
  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.connectCalendar(url.trim());
      setS(r.calendar);
      setUrl("");
      setMsg({ ok: true, text: `Connected. Found ${r.events} event${r.events === 1 ? "" : "s"} (including repeating ones). Try "what's on my calendar today?"` });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel form" aria-labelledby="cal-title">
      <h2 className="panel__title" id="cal-title">Calendar {s.connected ? "· connected (read-only)" : ""}</h2>
      {s.connected ? (
        <>
          <p className="muted small">
            ULTRON reads your calendar (never changes it) for "what's on my calendar?", your morning briefing and its greetings.
            {s.lastSyncAt ? ` Last read ${new Date(s.lastSyncAt).toLocaleTimeString()}.` : ""}
          </p>
          {s.error && <div className="banner banner--warn" role="status">Couldn't refresh: {s.error}</div>}
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => onAsk("What's on my calendar today?")}>What's on today?</button>
            {onThisPc() && (
              <button type="button" className="btn btn--danger" onClick={async () => { setS((await api.disconnectCalendar()).calendar); setMsg({ ok: true, text: "Calendar disconnected and its link deleted." }); }}>
                Disconnect
              </button>
            )}
          </div>
        </>
      ) : onThisPc() ? (
        <form onSubmit={connect} className="form">
          <p className="muted small">
            Paste your calendar's <strong>private address in iCal format</strong>. It's read-only and stays encrypted on this PC; paste it here, never in chat.
          </p>
          <ul className="small steps">
            <li><strong>Google Calendar</strong> (on a computer): Settings → click your calendar on the left → "Integrate calendar" → <em>Secret address in iCal format</em>.</li>
            <li><strong>Outlook.com</strong>: Settings → Calendar → Shared calendars → Publish a calendar → "Can view all details" → copy the <em>ICS</em> link.</li>
            <li><strong>iPhone / iCloud</strong>: Calendar app → tap ⓘ next to a calendar → Public Calendar → Share Link.</li>
          </ul>
          <label className="field">
            <span>Private iCal address</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn btn--primary" type="submit" disabled={busy || url.trim().length < 10}>{busy ? "Checking…" : "Connect calendar"}</button>
        </form>
      ) : (
        <p className="muted small">Connect your calendar on the PC (Connections → Calendar).</p>
      )}
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
    </section>
  );
}
