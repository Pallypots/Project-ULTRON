import { useCallback, useEffect, useRef, useState } from "react";
import { transcribe } from "../api.ts";
import { MicError, Recorder } from "./recorder.ts";
import { loadVoicePrefs } from "./prefs.ts";

export type PttState = "idle" | "starting" | "listening" | "transcribing";

const HOLD_MS = 350;
const MAX_SECONDS = 120;

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName) || el.isContentEditable);

/**
 * Push-to-talk: hold the button or the Space key to talk, release to finish.
 * A quick click instead latches recording on until the next click. Esc cancels and discards.
 */
export function usePushToTalk(onTranscript: (text: string) => void, enabled: boolean, onStart?: () => void) {
  const recorder = useRef(new Recorder());
  const [state, setState] = useState<PttState>("idle");
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pressedAt = useRef(0);
  const latched = useRef(false);
  const stateRef = useRef<PttState>("idle");
  const set = (s: PttState) => {
    stateRef.current = s;
    setState(s);
  };

  const start = useCallback(async () => {
    if (!enabled || stateRef.current !== "idle") return;
    setError(null);
    onStart?.(); // barge-in: silence ULTRON the moment the owner starts talking
    set("starting");
    try {
      await recorder.current.start(loadVoicePrefs().micId || undefined);
      set("listening");
    } catch (err) {
      set("idle");
      setError(err instanceof MicError ? err.message : String(err));
    }
  }, [enabled, onStart]);

  const finish = useCallback(async () => {
    latched.current = false;
    if (stateRef.current === "starting") {
      // Released before the mic opened; wait for it, then finish normally.
      await new Promise((r) => setTimeout(r, 150));
    }
    if (stateRef.current !== "listening") return;
    set("transcribing");
    try {
      const rec = await recorder.current.stop();
      if (!rec) return set("idle");
      const result = await transcribe(rec.wav);
      set("idle");
      if (result.text) onTranscript(result.text);
      else setError("I couldn't make out any words. Try again a little closer to the microphone.");
    } catch (err) {
      set("idle");
      setError((err as Error).message);
    }
  }, [onTranscript]);

  const cancel = useCallback(() => {
    latched.current = false;
    recorder.current.cancel();
    set("idle");
  }, []);

  // Button handlers: hold-to-talk, or click to latch.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      if (latched.current) return void finish();
      pressedAt.current = Date.now();
      start();
    },
    [start, finish],
  );
  const onPointerUp = useCallback(() => {
    if (latched.current || stateRef.current === "idle") return;
    if (Date.now() - pressedAt.current < HOLD_MS) latched.current = true;
    else finish();
  }, [finish]);

  // Keyboard: hold Space outside text fields; Esc cancels.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stateRef.current !== "idle" && stateRef.current !== "transcribing") return cancel();
      if (e.code !== "Space" || e.repeat || isTyping(e.target) || !enabled) return;
      e.preventDefault();
      pressedAt.current = Date.now();
      start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      if (stateRef.current === "listening" || stateRef.current === "starting") finish();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [start, finish, cancel, enabled]);

  // Live level + timer while listening; hard stop at the limit.
  useEffect(() => {
    if (state !== "listening") {
      setLevel(0);
      setSeconds(0);
      return;
    }
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      setLevel(recorder.current.level());
      const s = (Date.now() - t0) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) return void finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, finish]);

  // Never leave the microphone open if the view unmounts.
  useEffect(() => () => recorder.current.cancel(), []);

  return { state, level, seconds, error, clearError: () => setError(null), onPointerDown, onPointerUp, cancel, latched: latched.current };
}
