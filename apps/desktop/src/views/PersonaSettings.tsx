import { useEffect, useState } from "react";
import { api, type PersonaInfo } from "../api.ts";

const label = (v: number, words: [string, string, string]) => (v < 0.34 ? words[0] : v < 0.67 ? words[1] : words[2]);

/** In-app personality editor. Safety rules (no claims of feelings, no pretend access) are fixed and not editable. */
export function PersonaSettings({ onSaved }: { onSaved: () => void }) {
  const [p, setP] = useState<PersonaInfo | null>(null);
  const [wake, setWake] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const r = await api.persona();
    setP(r.persona);
    setWake(r.persona.wakeNames.join(", "));
  };
  useEffect(() => {
    load().catch(() => {});
  }, []);
  if (!p) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api.savePersona({
        name: p.name,
        ownerSalutation: p.ownerSalutation,
        wakeNames: wake.split(",").map((w) => w.trim()).filter(Boolean),
        tone: p.tone,
      });
      setP(r.persona);
      setMsg({ ok: true, text: "Saved. ULTRON's next reply uses the new personality." });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  const tone = (k: "humor" | "sarcasm" | "formality", v: number) => setP({ ...p, tone: { ...p.tone, [k]: v } });

  return (
    <form className="panel form" onSubmit={save} aria-labelledby="persona-title">
      <h2 className="panel__title" id="persona-title">Personality</h2>
      <div className="grid2">
        <label className="field">
          <span>Assistant's name</span>
          <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} maxLength={30} />
        </label>
        <label className="field">
          <span>How it addresses you (optional, e.g. "sir", "boss", your name)</span>
          <input value={p.ownerSalutation} onChange={(e) => setP({ ...p, ownerSalutation: e.target.value })} maxLength={40} />
        </label>
        <label className="field">
          <span>Wake words for hands-free (comma-separated single words)</span>
          <input value={wake} onChange={(e) => setWake(e.target.value)} />
        </label>
        <label className="field">
          <span>Answer length</span>
          <select value={p.tone.verbosity} onChange={(e) => setP({ ...p, tone: { ...p.tone, verbosity: e.target.value as PersonaInfo["tone"]["verbosity"] } })}>
            <option value="brief">Brief</option>
            <option value="adaptive">Adaptive (short for simple things, thorough when needed)</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
      </div>
      {(
        [
          ["humor", "Humor", ["rare", "light", "frequent"]],
          ["sarcasm", "Sarcasm", ["almost none", "gentle", "playful"]],
          ["formality", "Formality", ["casual", "relaxed", "formal"]],
        ] as const
      ).map(([k, name, words]) => (
        <label key={k} className="field">
          <span>{name}: {label(p.tone[k], words as unknown as [string, string, string])}</span>
          <input type="range" min={0} max={1} step={0.05} value={p.tone[k]} onChange={(e) => tone(k, Number(e.target.value))} />
        </label>
      ))}
      <p className="muted small">
        Fixed safety rules (not editable): ULTRON never claims feelings or consciousness, never pretends to have access it doesn't, and treats files, web pages and
        messages as information, not orders.
      </p>
      <div className="row">
        <button className="btn btn--primary" type="submit">Save personality</button>
        <button type="button" className="btn" onClick={async () => { await api.resetPersona(); await load(); onSaved(); setMsg({ ok: true, text: "Back to the default personality." }); }}>Reset to default</button>
      </div>
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
    </form>
  );
}
