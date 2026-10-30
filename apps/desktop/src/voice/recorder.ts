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

export class Recorder {
  private ctx: AudioContext | null = null;
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
    this.ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.node = new AudioWorkletNode(this.ctx, "ultron-tap");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.chunks.push(e.data);
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
    const rate = this.ctx.sampleRate;
    await new Promise((r) => setTimeout(r, 120)); // let the last worklet buffers arrive
    this.release();
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
    this.node?.disconnect();
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.node = null;
    this.analyser = null;
    this.ctx = null;
  }
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
}
