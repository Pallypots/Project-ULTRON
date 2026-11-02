import { useCallback, useEffect, useRef, useState } from "react";
import { concatFloat32, encodeWav, ENDS_CONVERSATION, isNoise, isSpeech, resample, seemsUnfinished, StreamResampler, type SileroVad } from "@ultron/audio";
import { api, transcribeWake } from "../api.ts";
import { explainMicError } from "./recorder.ts";
import { loadVoicePrefs } from "./prefs.ts";
import { loadVad } from "./vad.ts";

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("ultron-vad-tap", Tap);
`;

export type HandsFreeState = "off" | "starting" | "listening" | "hearing" | "checking" | "awake" | "followup" | "paused";

const FRAME_SEC = 0.02;
const START_FRAMES = 3; // 60 ms above threshold starts a phrase
const END_FRAMES = 35; // 700 ms of quiet ends it (loudness only)
const END_FRAMES_VAD = 22; // 440 ms with the speech detector: it knows a pause from a soft word, so it can be quicker
const PREROLL_FRAMES = 15; // keep 300 ms before speech started
const MAX_SEC = 10;
const MIN_SEC = 0.4;
const AWAKE_MS = 8000; // after just "Ultron", the next phrase is the command
const FOLLOW_MS = 15_000;
const HOLD_MS = 900; // you trailed off ("and, um…"): wait this long for the rest before answering
const BARGE_FRAMES = 15; // 300 ms of clearly loud speech while ULTRON talks counts as interrupting
const BARGE_GRACE_MS = 2000; // after an interruption, keep listening while the reply is being cancelled // conversation mode: how long ULTRON waits for your reply after answering

/**
 * Opt-in hands-free listening: a simple voice-activity detector cuts speech into phrases, each phrase is checked
 * for the wake word on this PC, and anything not addressed to ULTRON is discarded by the server unheard.
 */
export function useHandsFree(onCommand: (text: string) => void, paused: boolean, opts: { speaking?: boolean; onBargeIn?: () => void } = {}) {
  const [state, setState] = useState<HandsFreeState>("off");
  // The microphone level changes 50 times a second: kept out of React state so it never re-renders the chat.
  const levelRef = useRef(0);
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
    /** The first part of something you were still saying, waiting for the rest. */
    pending: "",
    /** A phrase you finished while the previous one was still being recognised. */
    backlog: null as Float32Array[] | null,
    holdTimer: 0 as ReturnType<typeof setTimeout> | 0,
    followTimer: 0 as ReturnType<typeof setTimeout> | 0,
    speaking: false,
    bargeIn: false,
    bargeAbove: 0,
    bargedUntil: 0,
    onBargeIn: undefined as (() => void) | undefined,
    /** The Silero speech detector (null until loaded, or if it can't load: then loudness decides). */
    vad: null as SileroVad | null,
    resampler: null as StreamResampler | null,
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
        if (res.text && (seemsUnfinished(res.text) || st.pending) && !ENDS_CONVERSATION.test(res.text)) {
          // Natural turn-taking: if you paused mid-thought, wait a moment for the rest instead of answering half a sentence.
          const soFar = st.pending ? `${st.pending} ${res.text}` : res.text;
          if (st.holdTimer) clearTimeout(st.holdTimer);
          if (seemsUnfinished(soFar) && soFar.length < 600) {
            st.pending = soFar;
            st.awakeUntil = Math.max(st.awakeUntil, Date.now() + HOLD_MS + 1500); // the rest needs no wake word
            const deliver = () => {
              if (!st.on || !st.pending) return;
              if (st.inPhrase || st.busy) return void (st.holdTimer = setTimeout(deliver, 400)); // still talking
              const text = st.pending;
              st.pending = "";
              st.holdTimer = 0;
              st.awakeUntil = 0;
              if (st.followTimer) clearTimeout(st.followTimer);
              st.conversing = st.openMic || loadVoicePrefs().conversation;
              onCommand(text);
            };
            st.holdTimer = setTimeout(deliver, HOLD_MS);
            return;
          }
          st.pending = "";
          res.text = soFar;
        }
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
      if (sent) st.backlog = null; // a command just went to ULTRON; the reply comes next
      if (st.backlog && st.on) {
        st.phrase = st.backlog;
        st.backlog = null;
        queueMicrotask(() => void finishPhraseRef.current?.());
      }
      if (sent || !st.on) {
        // The reply is coming; the pause/unpause cycle around it opens the follow-up window.
      } else {
        if (Date.now() >= st.awakeUntil && !st.openMic) st.conversing = false;
        set(idle());
      }
    }
  }, [onCommand]);

  const finishPhraseRef = useRef<(() => Promise<void>) | null>(null);
  finishPhraseRef.current = finishPhrase;
  const onFrame = useCallback(
    (f: Float32Array) => {
      const st = r.current;
      let sum = 0;
      for (const s of f) sum += s * s;
      const rms = Math.sqrt(sum / f.length);
      levelRef.current = Math.min(1, rms * 4);
      // Is this speech? The speech detector hears voices, not just noise; scored in the background, ~30 ms behind.
      if (st.vad && st.resampler) void st.vad.feed(st.resampler.push(f));
      const voiced = (inPhrase: boolean, threshold: number) => (st.vad ? isSpeech(st.vad.probability, inPhrase) && rms > 0.002 : rms > threshold);
      const barging = Date.now() < st.bargedUntil;
      // Interrupt by voice (opt-in): while ULTRON speaks, only clearly loud, sustained speech counts, well above its own
      // echo (which the browser's echo cancellation mostly removes). Then it stops talking and listens.
      if (st.paused && !barging && st.speaking && st.bargeIn && st.onBargeIn && !st.busy && !st.inPhrase) {
        st.preroll.push(f);
        if (st.preroll.length > PREROLL_FRAMES) st.preroll.shift();
        // Loud enough to be you, not ULTRON's own echo, and (with the detector) clearly a voice.
        if (rms > Math.max(0.05, st.floor * 8) && (!st.vad || st.vad.probability > 0.7)) {
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
      // Ignore everything while ULTRON is talking/thinking (no self-triggering). While a phrase is still being
      // recognised, keep listening: what you say meanwhile is kept and checked next, not thrown away.
      // (A phrase starting in the follow-up window counts even if the window ends while you're still talking.)
      if (st.paused && !barging) {
        st.inPhrase = false;
        st.phrase = [];
        st.above = 0;
        return;
      }
      const threshold = Math.max(0.012, st.floor * 3);
      if (!st.inPhrase) {
        st.preroll.push(f);
        if (st.preroll.length > PREROLL_FRAMES) st.preroll.shift();
        if (voiced(false, threshold)) {
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
      st.below = voiced(true, threshold) ? 0 : st.below + 1;
      if (st.below >= (st.vad ? END_FRAMES_VAD : END_FRAMES) || st.phrase.length * FRAME_SEC >= MAX_SEC) {
        if (st.busy) {
          // The previous phrase is still being recognised: queue this one (the newest wins).
          st.backlog = st.phrase;
          st.phrase = [];
          st.inPhrase = false;
        } else finishPhrase();
      }
    },
    [finishPhrase],
  );

  const stop = useCallback(() => {
    const st = r.current;
    if (st.on) api.setHandsFree(false).catch(() => {});
    st.on = false;
    st.conversing = false;
    st.openMic = false;
    st.pending = "";
    st.backlog = null;
    if (st.holdTimer) clearTimeout(st.holdTimer);
    if (st.followTimer) clearTimeout(st.followTimer);
    st.stream?.getTracks().forEach((t) => t.stop());
    st.node?.disconnect();
    st.ctx?.close().catch(() => {});
    Object.assign(st, { vad: null, resampler: null, ctx: null, stream: null, node: null, phrase: [], preroll: [], inPhrase: false, busy: false, awakeUntil: 0 });
    levelRef.current = 0;
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
      st.resampler = new StreamResampler(st.ctx.sampleRate);
      // Loudness works from the first frame; the speech detector takes over as soon as it has loaded.
      void loadVad().then((vad) => {
        if (!st.on || !vad) return;
        vad.reset();
        st.vad = vad;
      });
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

  const getLevel = useCallback(() => levelRef.current, []);
  return { state, getLevel, error, clearError: () => setError(null), start, stop, closeMic, on: state !== "off" };
}
