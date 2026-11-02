import { concatFloat32, encodeWav, resample } from "@ultron/audio";

// Captures raw PCM from the microphone with an AudioWorklet. The microphone is opened only for the
// duration of a recording and every track is stopped immediately afterwards, so the OS mic indicator turns off.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
  constructor() {
    super();
    // Everything posted before this reply has already arrived: no fixed wait needed when recording stops.
    this.port.onmessage = (e) => { if (e.data === "flush") this.port.postMessage("flushed"); };
  }
}
registerProcessor("ultron-tap", Tap);
`;

export class MicError extends Error {
  constructor(
    message: string,
    readonly code: "denied" | "not_found" | "busy" | "insecure" | "unknown",
  ) {
    super(message);
  }
}

export function explainMicError(err: unknown): MicError {
  const name = (err as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return new MicError("Microphone access is blocked. Click the lock/mic icon next to the address (or Windows Settings → Privacy & security → Microphone) and allow it for ULTRON.", "denied");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new MicError("No microphone was found. Plug one in, or pick another in Settings → Voice.", "not_found");
  if (name === "NotReadableError" || name === "AbortError") return new MicError("The microphone is in use by another app or was disconnected.", "busy");
  if (!globalThis.isSecureContext || !navigator.mediaDevices) return new MicError("Microphone access needs ULTRON to be opened at http://localhost.", "insecure");
  return new MicError(`Couldn't start the microphone: ${(err as Error)?.message ?? err}`, "unknown");
}

export interface Recording {
  wav: Uint8Array;
  seconds: number;
}

/**
 * One audio engine for push-to-talk, kept between recordings (paused while idle). Creating it and loading the tap took
 * 100–250 ms on every press; the microphone itself is still opened and released per recording.
 */
let shared: Promise<AudioContext> | null = null;
function audioEngine(): Promise<AudioContext> {
  shared ??= (async () => {
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    return ctx;
  })().catch((err) => {
    shared = null;
    throw err;
  });
  return shared;
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  /** How long the last stop() took from release to having the audio ready (diagnostics). */
  static lastStopMs = 0;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Float32Array[] = [];
  private levelBuf = new Float32Array(1024);

  get active() {
    return this.stream !== null;
  }

  async start(deviceId?: string): Promise<void> {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia) throw explainMicError(null);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      // A remembered device that was unplugged: fall back to the system default.
      if (deviceId && ((err as DOMException).name === "OverconstrainedError" || (err as DOMException).name === "NotFoundError")) return this.start(undefined);
      throw explainMicError(err);
    }
    this.chunks = [];
    this.ctx = await audioEngine();
    if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
    const source = (this.source = this.ctx.createMediaStreamSource(this.stream));
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.node = new AudioWorkletNode(this.ctx, "ultron-tap");
    this.node.port.onmessage = (e: MessageEvent<Float32Array | string>) => {
      if (typeof e.data !== "string") this.chunks.push(e.data);
    };
    source.connect(this.analyser);
    source.connect(this.node);
    // The worklet must reach the destination to keep running; route it through a muted gain so nothing is played back.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
  }

  /** Current input loudness 0..1 for the visualizer. */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const s of this.levelBuf) sum += s * s;
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 4);
  }

  async stop(): Promise<Recording | null> {
    if (!this.ctx || !this.stream) return null;
    const t0 = performance.now();
    const rate = this.ctx.sampleRate;
    // Wait for the tap to confirm everything it captured has been delivered (a fixed 120 ms wait used to be here).
    const node = this.node;
    if (node)
      await new Promise<void>((resolve) => {
        const done = setTimeout(resolve, 150); // never hang if the audio engine stalls
        node.port.addEventListener("message", (e) => {
          if (e.data === "flushed") {
            clearTimeout(done);
            resolve();
          }
        });
        node.port.postMessage("flush");
      });
    this.release();
    Recorder.lastStopMs = Math.round(performance.now() - t0);
    (window as unknown as { __ultronPttStopMs?: number }).__ultronPttStopMs = Recorder.lastStopMs;
    const samples = resample(concatFloat32(this.chunks), rate);
    this.chunks = [];
    return { wav: encodeWav(samples), seconds: samples.length / 16000 };
  }

  /** Stops the microphone and discards anything recorded. */
  cancel(): void {
    this.release();
    this.chunks = [];
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    // The engine stays loaded for next time, paused so it uses nothing meanwhile.
    this.ctx?.suspend().catch(() => {});
    this.stream = null;
    this.source = null;
    this.node = null;
    this.analyser = null;
    this.ctx = null;
  }
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
}
