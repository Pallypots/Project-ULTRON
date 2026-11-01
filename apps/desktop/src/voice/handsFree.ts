import { useCallback, useEffect, useRef, useState } from "react";
import { concatFloat32, encodeWav, ENDS_CONVERSATION, isNoise, resample } from "@ultron/audio";
import { api, transcribeWake } from "../api.ts";
import { explainMicError } from "./recorder.ts";
import { loadVoicePrefs } from "./prefs.ts";

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("ultron-vad-tap", Tap);
`;

export type HandsFreeState = "off" | "starting" | "listening" | "hearing" | "checking" | "awake" | "followup" | "paused";

const FRAME_SEC = 0.02;
const START_FRAMES = 3; // 60 ms above threshold starts a phrase
const END_FRAMES = 35; // 700 ms of quiet ends it
const PREROLL_FRAMES = 15; // keep 300 ms before speech started
const MAX_SEC = 10;
const MIN_SEC = 0.4;
const AWAKE_MS = 8000; // after just "Ultron", the next phrase is the command
const FOLLOW_MS = 15_000;
const BARGE_FRAMES = 15; // 300 ms of clearly loud speech while ULTRON talks counts as interrupting
const BARGE_GRACE_MS = 2000; // after an interruption, keep listening while the reply is being cancelled // conversation mode: how long ULTRON waits for your reply after answering

/**
 * Opt-in hands-free listening: a simple voice-activity detector cuts speech into phrases, each phrase is checked
 * for the wake word on this PC, and anything not addressed to ULTRON is discarded by the server unheard.
 */
export function useHandsFree(onCommand: (text: string) => void, paused: boolean, opts: { speaking?: boolean; onBargeIn?: () => void } = {}) {
  const [state, setState] = useState<HandsFreeState>("off");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const r = useRef({
    ctx: null as AudioContext | null,
    stream: null as MediaStream | null,
    node: null as AudioWorkletNode | null,
    frame: [] as number[],
    frameSize: 960,
    floor: 0.01,
    above: 0,
    below: 0,
    preroll: [] as Float32Array[],
    phrase: [] as Float32Array[],
    inPhrase: false,
    busy: false,
    awakeUntil: 0,
    paused: false,
    on: false,
    conversing: false,
    /** Council mode: a continuous conversation; every phrase is for ULTRON, no wake word, no time-out. */
    openMic: false,
    followTimer: 0 as ReturnType<typeof setTimeout> | 0,
    speaking: false,
    bargeIn: false,
    bargeAbove: 0,
    bargedUntil: 0,
    onBargeIn: undefined as (() => void) | undefined,
  });
  const set = (s: HandsFreeState) => setState(s);
  r.current.paused = paused;
  r.current.speaking = Boolean(opts.speaking);
  r.current.onBargeIn = opts.onBargeIn;
  // What to show while waiting: a reply window, a just-heard-"Ultron" window, or plain listening for the wake word.
  const idle = (): HandsFreeState => {
    const st = r.current;
    if (st.openMic) return "followup";
    if (Date.now() >= st.awakeUntil) return "listening";
    return st.conversing ? "followup" : "awake";
  };

  const finishPhrase = useCallback(async () => {
    const st = r.current;
    const ctx = st.ctx;
    const chunks = st.phrase;
    st.phrase = [];
    st.inPhrase = false;
    if (!ctx || !chunks.length) return;
    const samples = resample(concatFloat32(chunks), ctx.sampleRate);
    if (samples.length / 16000 < MIN_SEC) return set(idle());
    st.busy = true;
    set("checking");
    let sent = false;
    try {
      const awake = st.openMic || Date.now() < st.awakeUntil;
      const following = awake && (st.conversing || st.openMic);
      const res = await transcribeWake(encodeWav(samples), !awake);
      if (!st.on) return;
      // In a follow-up there's no wake word, so filter Whisper's noise "words" before treating it as a reply.
      if (following && res.text && isNoise(res.text)) return;
      if (res.addressed) {
        if (res.text) {
          st.awakeUntil = 0;
          if (st.followTimer) clearTimeout(st.followTimer);
          st.conversing = st.openMic || (loadVoicePrefs().conversation && !ENDS_CONVERSATION.test(res.text));
          sent = true;
          onCommand(res.text);
        } else {
          // Just the name: listen for the command next.
          st.awakeUntil = Date.now() + AWAKE_MS;
          set("awake");
          return;
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      st.busy = false;
      if (sent || !st.on) {
        // The reply is coming; the pause/unpause cycle around it opens the follow-up window.
      } else {
        if (Date.now() >= st.awakeUntil && !st.openMic) st.conversing = false;
        set(idle());
      }
    }
  }, [onCommand]);

  const onFrame = useCallback(
    (f: Float32Array) => {
      const st = r.current;
      let sum = 0;
      for (const s of f) sum += s * s;
      const rms = Math.sqrt(sum / f.length);
      setLevel(Math.min(1, rms * 4));
      const barging = Date.now() < st.bargedUntil;
      // Interrupt by voice (opt-in): while ULTRON speaks, only clearly loud, sustained speech counts, well above its own
      // echo (which the browser's echo cancellation mostly removes). Then it stops talking and listens.
      if (st.paused && !barging && st.speaking && st.bargeIn && st.onBargeIn && !st.busy && !st.inPhrase) {
        st.preroll.push(f);
        if (st.preroll.length > PREROLL_FRAMES) st.preroll.shift();
        if (rms > Math.max(0.05, st.floor * 8)) {
          if (++st.bargeAbove >= BARGE_FRAMES) {
            st.bargeAbove = 0;
            st.bargedUntil = Date.now() + BARGE_GRACE_MS;
            st.awakeUntil = Date.now() + FOLLOW_MS; // what you say next needs no wake word
            st.conversing = loadVoicePrefs().conversation;
            st.inPhrase = true;
            st.below = 0;
            st.phrase = [...st.preroll];
            st.preroll = [];
            set("hearing");
            st.onBargeIn();
          }
        } else st.bargeAbove = 0;
        return;
      }
      // Ignore everything while ULTRON is talking/thinking or a phrase is being checked (no self-triggering).
      // (A phrase starting in the follow-up window counts even if the window ends while you're still talking.)
      if ((st.paused && !barging) || st.busy) {
        st.inPhrase = false;
        st.phrase = [];
        st.above = 0;
        return;
      }
      const threshold = Math.max(0.012, st.floor * 3);
      if (!st.inPhrase) {
        st.preroll.push(f);
        if (st.preroll.length > PREROLL_FRAMES) st.preroll.shift();
        if (rms > threshold) {
          if (++st.above >= START_FRAMES) {
            st.inPhrase = true;
            st.below = 0;
            st.phrase = [...st.preroll];
            st.preroll = [];
            set("hearing");
          }
        } else {
          st.above = 0;
          st.floor = st.floor * 0.97 + rms * 0.03; // adapt to background noise
        }
        return;
      }
      st.phrase.push(f);
      st.below = rms > threshold ? 0 : st.below + 1;
      if (st.below >= END_FRAMES || st.phrase.length * FRAME_SEC >= MAX_SEC) finishPhrase();
    },
    [finishPhrase],
  );

  const stop = useCallback(() => {
    const st = r.current;
    if (st.on) api.setHandsFree(false).catch(() => {});
    st.on = false;
    st.conversing = false;
    st.openMic = false;
    if (st.followTimer) clearTimeout(st.followTimer);
    st.stream?.getTracks().forEach((t) => t.stop());
    st.node?.disconnect();
    st.ctx?.close().catch(() => {});
    Object.assign(st, { ctx: null, stream: null, node: null, phrase: [], preroll: [], inPhrase: false, busy: false, awakeUntil: 0 });
    setLevel(0);
    set("off");
  }, []);

  /** `conversation`: start already listening for you (no wake word for the first thing you say), e.g. from "Talk to ULTRON". */
  const start = useCallback(async (opts: { conversation?: boolean; openMic?: boolean } = {}) => {
    const st = r.current;
    st.openMic = Boolean(opts.openMic);
    if (st.on) {
      st.bargeIn = loadVoicePrefs().bargeIn || st.openMic;
      if (st.openMic) set("followup");
      return;
    }
    setError(null);
    set("starting");
    try {
      await api.setHandsFree(true);
      const micId = loadVoicePrefs().micId;
      st.stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: micId ? { exact: micId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      st.ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await st.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      st.frameSize = Math.round(st.ctx.sampleRate * FRAME_SEC);
      const src = st.ctx.createMediaStreamSource(st.stream);
      st.node = new AudioWorkletNode(st.ctx, "ultron-vad-tap");
      st.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        for (const s of e.data) {
          st.frame.push(s);
          if (st.frame.length >= st.frameSize) {
            onFrame(Float32Array.from(st.frame));
            st.frame = [];
          }
        }
      };
      const mute = st.ctx.createGain();
      mute.gain.value = 0;
      src.connect(st.node).connect(mute).connect(st.ctx.destination);
      st.on = true;
      // Council mode is a real back-and-forth: you can always talk over ULTRON to interrupt.
      st.bargeIn = loadVoicePrefs().bargeIn || st.openMic;
      if (opts.conversation) {
        st.conversing = true;
        st.awakeUntil = Date.now() + FOLLOW_MS * 2;
        set("followup");
        st.followTimer = setTimeout(() => {
          if (!st.on || st.openMic || st.inPhrase || st.busy || st.paused || Date.now() < st.awakeUntil) return;
          st.conversing = false;
          set("listening");
        }, FOLLOW_MS * 2 + 50);
      } else set("listening");
    } catch (err) {
      const message = (err as { status?: number }).status === 409 ? (err as Error).message : explainMicError(err).message;
      st.on = true; // so stop() records "off"
      stop();
      setError(message);
    }
  }, [onFrame, stop]);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    if (state === "off" || state === "starting") return;
    const st = r.current;
    if (Date.now() < st.bargedUntil && (st.inPhrase || st.busy)) return; // mid-interruption: keep showing "hearing"
    if (paused && state !== "paused") set("paused");
    if (!paused && state === "paused") {
      // ULTRON just finished answering: in conversation mode, listen for a reply without the wake word.
      if ((st.conversing || st.openMic) && st.on) {
        st.awakeUntil = Date.now() + FOLLOW_MS;
        set("followup");
        if (st.followTimer) clearTimeout(st.followTimer);
        st.followTimer = setTimeout(() => {
          // Only give up if nothing was said; a reply in progress keeps the conversation going.
          // ULTRON started talking again (or you're mid-reply): the next pause/unpause re-opens the window instead.
          if (!st.on || st.openMic || st.inPhrase || st.busy || st.paused) return;
          st.conversing = false;
          st.awakeUntil = 0;
          set("listening");
        }, FOLLOW_MS);
      } else set("listening");
    }
  }, [paused, state]);

  /** Leave Council mode without stopping hands-free: back to needing the wake word after the usual reply window. */
  const closeMic = useCallback(() => {
    r.current.openMic = false;
  }, []);

  return { state, level, error, clearError: () => setError(null), start, stop, closeMic, on: state !== "off" };
}
