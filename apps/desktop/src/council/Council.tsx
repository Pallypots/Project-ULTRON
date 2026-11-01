import { useEffect, useRef, useState } from "react";
import type { ToolEvent } from "@ultron/schemas";
import { ToolChips } from "../ToolChips.tsx";
import { Face } from "./Face.tsx";
import type { FaceMood } from "./face.ts";

const STATUS: Record<FaceMood, string> = {
  idle: "I'm listening. Just talk.",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "",
  offline: "Offline",
  error: "Something needs your attention",
};

/**
 * Council mode: full screen, just ULTRON's face and a conversation. The microphone stays open (no wake word) until
 * you leave with Esc, the × button, or by saying "that's all".
 */
export function Council({ mood, level, said, heard, brain, problem, activity, pending, onSend, onExit }: {
  mood: FaceMood;
  level: { current: number };
  /** What ULTRON is saying / last said. */
  said: string;
  /** What you last said. */
  heard: string;
  brain: string;
  problem: string | null;
  /** What ULTRON is doing or just did (an action), shown like a HUD readout. */
  activity?: string | null;
  /** Actions waiting for approval, with Approve / Deny right here. */
  pending?: ToolEvent[];
  onSend: (text: string) => void;
  onExit: () => void;
}) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const exitRef = useRef<HTMLButtonElement>(null);
  // Focus the exit button once when Council opens (not on every redraw: the face and mic level redraw constantly, and
  // stealing focus then would send Enter from the text box to the exit button).
  useEffect(() => {
    exitRef.current?.focus();
  }, []);
  const exitNow = useRef(onExit);
  exitNow.current = onExit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !typing) exitNow.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typing]);
  // Show the tail of a long reply, a sentence or two, like subtitles.
  const caption = said.replace(/\s+/g, " ").replace(/[*#`]/g, "").trim();
  const tail = caption.length > 260 ? "…" + caption.slice(caption.length - 260).replace(/^\S*\s/, "") : caption;
  return (
    <div className={`council council--${mood}`} role="dialog" aria-modal="true" aria-label="Council mode: talk with ULTRON">
      <div className="council__bg" aria-hidden="true" />
      <header className="council__top">
        <div>
          <div className="council__title">COUNCIL</div>
          <div className="council__sub">{brain}</div>
        </div>
        <button ref={exitRef} type="button" className="council__exit" onClick={onExit} aria-label="Leave Council mode (Esc)" title="Leave Council mode (Esc)">×</button>
      </header>
      <Face mood={mood} level={level} />
      <div className="council__captions" aria-live="polite">
        {heard && <p className="council__heard">“{heard}”</p>}
        {tail && <p className="council__said">{tail}</p>}
        {activity && <p className="council__activity">{activity}</p>}
        {pending && pending.length > 0 && <div className="council__pending"><ToolChips events={pending} /></div>}
        <p className="council__status">{problem ?? STATUS[mood]}</p>
      </div>
      <footer className="council__bottom">
        {typing ? (
          <form
            className="council__type"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              onSend(text.trim());
              setText("");
            }}
          >
            <label className="sr-only" htmlFor="council-input">Type to ULTRON</label>
            <input id="council-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Type to ULTRON…" autoComplete="off" onKeyDown={(e) => e.key === "Escape" && setTyping(false)} />
            <button type="submit" className="btn btn--primary">Send</button>
          </form>
        ) : (
          <button type="button" className="link council__typelink" onClick={() => setTyping(true)}>Type instead</button>
        )}
        <span className="council__hint">Esc or say “that's all” to leave</span>
      </footer>
    </div>
  );
}
