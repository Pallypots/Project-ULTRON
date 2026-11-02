import { useEffect, useState } from "react";
import { api, type PerfReport, type PerfStat } from "../api.ts";

const s = (ms: number | null | undefined) => (ms == null ? "–" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

const ROWS: { key: keyof PerfReport["summary"]; label: string; unit?: "tok" | "tps" }[] = [
  { key: "speechRecognition", label: "Understanding your speech" },
  { key: "context", label: "Gathering memories and context" },
  { key: "modelLoad", label: "Loading the brain (should be ~0)" },
  { key: "promptReading", label: "Brain reading the conversation" },
  { key: "promptTokens", label: "…how much it read", unit: "tok" },
  { key: "firstWord", label: "First word of the answer" },
  { key: "firstSentence", label: "First full sentence" },
  { key: "firstSound", label: "First sound you hear" },
  { key: "whole", label: "Whole answer written" },
  { key: "outputTokensPerSec", label: "Brain writing speed", unit: "tps" },
];

/** Settings → Performance: where each reply's time goes on this PC, measured, with plain-English findings. */
export function PerformancePanel() {
  const [r, setR] = useState<PerfReport | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    setBusy(true);
    api.perf().then(setR).catch(() => {}).finally(() => setBusy(false));
  };
  useEffect(load, []);
  const fmt = (st: PerfStat, unit?: "tok" | "tps") => (unit === "tok" ? `${st.p50 ?? "–"} tokens` : unit === "tps" ? (st.p50 == null ? "–" : `${st.p50}/s`) : s(st.p50));
  return (
    <section className="panel" aria-labelledby="perf-title">
      <h2 className="panel__title" id="perf-title">Performance {r ? `· ${r.summary.turns} replies measured` : ""}</h2>
      <p className="muted small">Where the time goes when ULTRON answers, measured on this PC (typical, and slow 1-in-10). Nothing you say is recorded, only timings.</p>
      {r && (
        <>
          <ul className="perf-findings">
            {r.diagnosis.map((d, i) => <li key={i}>{d}</li>)}
            {r.responsiveness && r.responsiveness.sinceMs > 5000 && (
              <li>
                {r.responsiveness.worstMs <= 100
                  ? `Service responsiveness: good (its longest pause in the last ${Math.round(r.responsiveness.sinceMs / 60000) || 1} min was ${r.responsiveness.worstMs} ms).`
                  : `Service responsiveness: it froze for up to ${(r.responsiveness.worstMs / 1000).toFixed(1)} s in the last ${Math.round(r.responsiveness.sinceMs / 60000) || 1} min (typical worst ${r.responsiveness.p99Ms} ms). That delays replies and buttons; please send this screen to whoever maintains ULTRON.`}
              </li>
            )}
            {r.wake?.available && <li>{wakeLine(r.wake)}</li>}
          </ul>
          <table className="perf-table">
            <thead><tr><th>Stage</th><th>Typical</th><th>Slow</th></tr></thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.key}><td>{row.label}</td><td>{fmt(r.summary[row.key] as PerfStat, row.unit)}</td><td>{row.unit ? "" : s((r.summary[row.key] as PerfStat).p90)}</td></tr>
              ))}
            </tbody>
          </table>
          {r.hardware && (
            <p className="small muted">
              This PC: {r.hardware.cpuThreads} processor threads, {Math.round(r.hardware.ramBytes / 1e9)} GB memory;{" "}
              {r.hardware.gpus.length ? r.hardware.gpus.map((g) => `${g.name}${g.vramBytes ? ` (${Math.round(g.vramBytes / 1e9)} GB)` : ""}`).join(", ") : "no graphics card found"}.
              {r.ollama?.length ? ` Loaded brain: ${r.ollama.map((m) => `${m.name}, ${m.size ? Math.round((100 * m.sizeVram) / m.size) : 0}% on the graphics card`).join("; ")}.` : ""}
            </p>
          )}
        </>
      )}
      <button type="button" className="btn btn--small" onClick={load} disabled={busy}>{busy ? "Measuring…" : "Refresh"}</button>
    </section>
  );
}

/** Plain-English state of the hands-free wake-word detector's trial. */
function wakeLine(w: NonNullable<PerfReport["wake"]>): string {
  if (w.trusted)
    return `Wake-word detector: on. It caught your wake name ${w.caught} of ${w.named} times in its trial, so phrases without the name are now dropped straight away (${w.skipped} so far), saving full speech recognition each time.`;
  return `Wake-word detector: learning your voice (${w.named} of ${w.needed} wake words heard, ${w.caught} caught by the detector). Until it's proved itself, hands-free works exactly as before.`;
}
