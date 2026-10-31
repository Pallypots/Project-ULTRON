import { useEffect, useState } from "react";
import { api, type CheckIn } from "../api.ts";

/** Settings → Morning check-in: ULTRON says good morning first, with your day at a glance. */
export function CheckInSettings() {
  const [c, setC] = useState<CheckIn | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api.checkin().then((r) => setC(r.checkin)).catch(() => {});
  }, []);
  if (!c) return null;
  const save = async (next: CheckIn) => {
    setC(next);
    setSaved(false);
    await api.saveCheckin(next);
    setSaved(true);
  };
  return (
    <section className="panel form" aria-labelledby="checkin-title">
      <h2 className="panel__title" id="checkin-title">Check-ins</h2>
      <label className="toggle">
        <input type="checkbox" checked={c.enabled} onChange={(e) => save({ ...c, enabled: e.target.checked })} />
        <span>Each morning, ULTRON says good morning first with your day at a glance (calendar, to-dos due, reminders) and a "Brief me" button</span>
      </label>
      <label className="field" style={{ maxWidth: 200 }}>
        <span>At (or when ULTRON starts, if later that morning)</span>
        <input type="time" value={c.time} onChange={(e) => save({ ...c, time: e.target.value })} disabled={!c.enabled} />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={c.evening} onChange={(e) => save({ ...c, evening: e.target.checked })} />
        <span>Evening check-in: ULTRON asks how your day went, with a "Talk" button to tell it</span>
      </label>
      <label className="field" style={{ maxWidth: 200 }}>
        <span>Evening check-in at</span>
        <input type="time" value={c.eveningTime} onChange={(e) => save({ ...c, eveningTime: e.target.value })} disabled={!c.evening} />
      </label>
      {saved && <p className="muted small" role="status">Saved.</p>}
    </section>
  );
}
