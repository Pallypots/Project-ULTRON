/**
 * Silero VAD (v5/v6 ONNX): "is someone speaking?" from the sound itself, not just loudness, so fans, keyboards, music
 * and the hum of a room don't start phrases. Runs on any ONNX runtime with the same API (onnxruntime-web in the app,
 * onnxruntime-node in tests). 16 kHz audio in 512-sample windows (32 ms), with the previous 64 samples as context,
 * exactly as Silero's own reference wrapper does.
 */
export interface OrtLike {
  Tensor: new (type: "float32" | "int64", data: Float32Array | BigInt64Array, dims: number[]) => unknown;
  InferenceSession: { create(model: string | Uint8Array, opts?: Record<string, unknown>): Promise<OrtSessionLike> };
}
interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | ArrayLike<number> }>>;
}

export const VAD_WINDOW = 512;
const CONTEXT = 64;

export class SileroVad {
  private state: Float32Array = new Float32Array(2 * 128);
  private context = new Float32Array(CONTEXT);
  private pending = new Float32Array(0);
  private chain: Promise<unknown> = Promise.resolve();
  /** The newest speech probability, 0..1 (updated about every 32 ms of audio). */
  probability = 0;

  private constructor(private ort: OrtLike, private session: OrtSessionLike) {}

  static async load(ort: OrtLike, model: string | Uint8Array, opts?: Record<string, unknown>): Promise<SileroVad> {
    return new SileroVad(ort, await ort.InferenceSession.create(model, opts));
  }

  reset() {
    this.state = new Float32Array(2 * 128);
    this.context = new Float32Array(CONTEXT);
    this.pending = new Float32Array(0);
    this.probability = 0;
  }

  /** One 512-sample window at 16 kHz → speech probability. */
  async window(samples: Float32Array): Promise<number> {
    const input = new Float32Array(CONTEXT + VAD_WINDOW);
    input.set(this.context, 0);
    input.set(samples.subarray(0, VAD_WINDOW), CONTEXT);
    this.context = input.slice(input.length - CONTEXT);
    const out = await this.session.run({
      input: new this.ort.Tensor("float32", input, [1, input.length]),
      state: new this.ort.Tensor("float32", this.state, [2, 1, 128]),
      sr: new this.ort.Tensor("int64", BigInt64Array.from([16000n]), []),
    });
    this.state = Float32Array.from(out.stateN!.data as ArrayLike<number>);
    this.probability = Number((out.output!.data as ArrayLike<number>)[0] ?? 0);
    return this.probability;
  }

  /**
   * Streaming: feed 16 kHz audio of any length; windows are scored in order in the background and `probability` is
   * kept current. Returns a promise for when everything fed so far has been scored.
   */
  feed(samples16k: Float32Array): Promise<unknown> {
    const joined = new Float32Array(this.pending.length + samples16k.length);
    joined.set(this.pending, 0);
    joined.set(samples16k, this.pending.length);
    let off = 0;
    for (; off + VAD_WINDOW <= joined.length; off += VAD_WINDOW) {
      const w = joined.slice(off, off + VAD_WINDOW);
      this.chain = this.chain.then(() => this.window(w)).catch(() => undefined);
    }
    this.pending = joined.slice(off);
    return this.chain;
  }
}

/**
 * Turns the probability stream into speech on/off with hysteresis (Silero's recommended 0.5 to start, 0.35 to keep
 * going), so a word's soft ending doesn't flicker it off.
 */
export function isSpeech(probability: number, alreadySpeaking: boolean, start = 0.5, keep = 0.35): boolean {
  return probability >= (alreadySpeaking ? keep : start);
}

/** Streaming linear resampler to 16 kHz that carries its position across chunks (no clicks at chunk joins). */
export class StreamResampler {
  /** Position of the next output sample, in input samples; -1 means "the last sample of the previous chunk". */
  private pos = 0;
  private last = 0;
  constructor(private fromRate: number, private toRate = 16000) {}
  push(input: Float32Array): Float32Array {
    if (this.fromRate === this.toRate) return input;
    const ratio = this.fromRate / this.toRate;
    const out: number[] = [];
    while (this.pos < input.length - 1) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i < 0 ? this.last : input[i]!;
      const b = input[i + 1]!;
      out.push(a + (b - a) * frac);
      this.pos += ratio;
    }
    this.pos -= input.length;
    if (input.length) this.last = input[input.length - 1]!;
    return Float32Array.from(out);
  }
}
