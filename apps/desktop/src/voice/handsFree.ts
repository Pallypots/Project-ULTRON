import { useCallback, useEffect, useRef, useState } from "react";
import { concatFloat32, encodeWav, resample } from "@ultron/audio";
import { api, transcribeWake } from "../api.ts";
import { explainMicError } from "./recorder.ts";
import { loadVoicePrefs } from "./prefs.ts";

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("ultron-vad-tap", Tap);
`;

export type HandsFreeState = "off" | "starting" | "listening" | "hearing" | "checking" | "awake" | "paused";

const FRAME_SEC = 0.02;
const START_FRAMES = 3; // 60 ms above threshold starts a phrase
const END_FRAMES = 35; // 700 ms of quiet ends it
const PREROLL_FRAMES = 15; // keep 300 ms before speech started
const MAX_SEC = 10;
const MIN_SEC = 0.4;
const AWAKE_MS = 8000; // after just "Ultron", the next phrase is the command

/**
 * Opt-in hands-free listening: a simple voice-activity detector cuts speech into phrases, each phrase is checked
 * for the wake word on this PC, and anything not addressed to ULTRON is discarded by the server unheard.
 */
export function useHandsFree(onCommand: (text: string) => void, paused: boolean) {
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
  });
  const set = (s: HandsFreeState) => setState(s);
  r.current.paused = paused;

  const finishPhrase = useCallback(async () => {
    const st = r.current;
    const ctx = st.ctx;
    const chunks = st.phrase;
    st.phrase = [];
    st.inPhrase = false;
    if (!ctx || !chunks.length) return;
    const samples = resample(concatFloat32(chunks), ctx.sampleRate);
    if (samples.length / 16000 < MIN_SEC) return set("listening");
    st.busy = true;
    set("checking");
    try {
      const awake = Date.now() < st.awakeUntil;
      const res = await transcribeWake(encodeWav(samples), !awake);
      if (!st.on) return;
      if (res.addressed) {
        if (res.text) {
          st.awakeUntil = 0;
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
      if (st.on && Date.now() >= st.awakeUntil) set("listening");
    }
  }, [onCommand]);

  const onFrame = useCallback(
    (f: Float32Array) => {
      const st = r.current;
      let sum = 0;
      for (const s of f) sum += s * s;
      const rms = Math.sqrt(sum / f.length);
      setLevel(Math.min(1, rms * 4));
      // Ignore everything while ULTRON is talking/thinking or a phrase is being checked (no self-triggering).
      if (st.paused || st.busy) {
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
    st.stream?.getTracks().forEach((t) => t.stop());
    st.node?.disconnect();
    st.ctx?.close().catch(() => {});
    Object.assign(st, { ctx: null, stream: null, node: null, phrase: [], preroll: [], inPhrase: false, busy: false, awakeUntil: 0 });
    setLevel(0);
    set("off");
  }, []);

  const start = useCallback(async () => {
    const st = r.current;
    if (st.on) return;
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
      set("listening");
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
    if (paused && state !== "paused") set("paused");
    if (!paused && state === "paused") set("listening");
  }, [paused, state]);

  return { state, level, error, clearError: () => setError(null), start, stop, on: state !== "off" };
}
