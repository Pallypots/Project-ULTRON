import { useState } from "react";
import type { Hud, Status } from "../api.ts";
import type { View } from "../App.tsx";

const KEY = "ultron.setupHidden";
const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/** First steps for a new owner: each ticks itself off as it's done; hidden once everything's done (or on request). */
export function SetupCard({ status, hud, onNavigate, onTalk }: { status: Status | null; hud: Hud | null; onNavigate: (v: View) => void; onTalk: () => void }) {
  const [hidden, setHidden] = useState(read);
  if (!status || !hud || hidden) return null;
  const steps: { done: boolean; label: string; why: string; go: () => void; action: string }[] = [
    { done: status.where !== "test", label: "Give ULTRON a real brain", why: "Local AI is free, private and runs on this PC.", go: () => onNavigate("settings"), action: "Set up Local AI" },
    { done: Boolean(status.persona.salutation), label: "Tell ULTRON what to call you", why: "Your name, or \"sir\".", go: () => onNavigate("settings"), action: "Personality" },
    { done: hud.homeLocationSet, label: "Set your home city", why: "For the weather and rain warnings.", go: () => onNavigate("settings"), action: "Personality" },
    { done: status.counts.conversations > 1, label: "Talk to him", why: "Just speak; no typing needed.", go: onTalk, action: "Talk now" },
    { done: hud.calendarConnected || hud.email !== null || hud.home !== null, label: "Connect something (optional)", why: "Calendar, email or smart home.", go: () => onNavigate("connections"), action: "Link an account" },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;
  return (
    <section className="hud-panel setup" aria-labelledby="setup-title">
      <h2 className="hud-panel__title" id="setup-title">
        <span>GET ULTRON READY · {steps.length - left}/{steps.length}</span>
        <button type="button" className="btn btn--small" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch {} setHidden(true); }}>Hide</button>
      </h2>
      <ol className="setup__steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? "is-done" : ""}>
            <span className="setup__tick" aria-hidden="true">{s.done ? "✓" : ""}</span>
            <span><strong>{s.label}</strong> <span className="muted small">{s.why}</span></span>
            {!s.done && <button type="button" className="btn btn--small" onClick={s.go}>{s.action}</button>}
            {s.done && <span className="sr-only">done</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
