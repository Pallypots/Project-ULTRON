import { useEffect, useState } from "react";
import { api, type Routine } from "../api.ts";

const newId = () => Math.random().toString(36).slice(2, 10);

/** Settings → Routines: one phrase runs several instant commands. */
export function RoutinesSettings() {
  const [list, setList] = useState<Routine[] | null>(null);
  const [examples, setExamples] = useState<Omit<Routine, "id">[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api.routines().then((r) => { setList(r.routines); setExamples(r.examples); }).catch(() => {});
  }, []);
  if (!list) return null;
  const update = (id: string, patch: Partial<Routine>) => setList(list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const save = async (next = list) => {
    setMsg(null);
    try {
      const r = await api.saveRoutines(next.map((x) => ({ ...x, phrases: x.phrases.map((p) => p.trim()).filter(Boolean), steps: x.steps.map((s) => s.trim()).filter(Boolean) })));
      setList(r.routines);
      setMsg({ ok: true, text: "Saved. Say a routine's phrase to run it." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const unused = examples.filter((e) => !list.some((r) => r.name === e.name));
  return (
    <section className="panel form" aria-labelledby="routines-title">
      <h2 className="panel__title" id="routines-title">Routines</h2>
      <p className="muted small">
        Say one phrase and ULTRON runs several commands in a row, e.g. "good night" → pause the music, tomorrow's calendar, your to-do list.
        Steps are things you could say to ULTRON (music, apps, calendar, list, weather, reminders, conversions). Opening apps still asks first.
      </p>
      {list.map((r) => (
        <fieldset key={r.id} className="routine">
          <legend className="sr-only">{r.name}</legend>
          <div className="grid2">
            <label className="field">
              <span>Name</span>
              <input value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} maxLength={40} />
            </label>
            <label className="field">
              <span>Phrases that start it (comma-separated)</span>
              <input value={r.phrases.join(", ")} onChange={(e) => update(r.id, { phrases: e.target.value.split(",") })} />
            </label>
          </div>
          <label className="field">
            <span>Steps (one per line)</span>
            <textarea rows={Math.max(3, r.steps.length + 1)} value={r.steps.join("\n")} onChange={(e) => update(r.id, { steps: e.target.value.split("\n") })} />
          </label>
          <div className="row">
            <label className="toggle">
              <input type="checkbox" checked={r.enabled} onChange={(e) => update(r.id, { enabled: e.target.checked })} />
              <span>On</span>
            </label>
            <button type="button" className="btn btn--small btn--danger" onClick={() => save(list.filter((x) => x.id !== r.id))}>Delete</button>
          </div>
        </fieldset>
      ))}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => save()}>Save routines</button>
        <button type="button" className="btn" onClick={() => setList([...list, { id: newId(), name: "My routine", phrases: ["my phrase"], steps: ["what's the weather"], enabled: true }])}>+ New routine</button>
        {unused.map((e) => (
          <button key={e.name} type="button" className="btn btn--small" onClick={() => save([...list, { ...e, id: newId() }])}>+ Add "{e.name}"</button>
        ))}
      </div>
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
    </section>
  );
}
