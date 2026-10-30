import { mkdirSync } from "node:fs";
import { TtsError, type TtsEngine, type TtsStatus, type TtsVoice } from "./types.ts";

export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

// A curated subset of Kokoro's voices (quality grades from the voice pack's own metadata).
export const KOKORO_VOICES: TtsVoice[] = [
  { id: "bm_george", name: "George", accent: "British", gender: "Male", quality: "C" },
  { id: "bm_fable", name: "Fable", accent: "British", gender: "Male", quality: "C" },
  { id: "bf_emma", name: "Emma", accent: "British", gender: "Female", quality: "B-" },
  { id: "af_heart", name: "Heart", accent: "American", gender: "Female", quality: "A" },
  { id: "af_bella", name: "Bella", accent: "American", gender: "Female", quality: "A-" },
  { id: "am_michael", name: "Michael", accent: "American", gender: "Male", quality: "C+" },
  { id: "am_fenrir", name: "Fenrir", accent: "American", gender: "Male", quality: "C+" },
  { id: "am_puck", name: "Puck", accent: "American", gender: "Male", quality: "C+" },
];

interface Kokoro {
  generate(text: string, opts: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
}

/**
 * Kokoro-82M (Apache-2.0) running on this computer via kokoro-js + ONNX Runtime.
 * The ~90 MB model downloads once from Hugging Face into <data>/models; voices ship with the package.
 */
export class KokoroEngine implements TtsEngine {
  readonly id = "local";
  readonly voices = KOKORO_VOICES;
  private tts: Kokoro | null = null;
  private loading: Promise<Kokoro> | null = null;
  private state: TtsStatus = { state: "not_loaded", detail: "The voice downloads the first time ULTRON speaks (about 90 MB, one time)." };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private cacheDir: string,
    readonly dtype: "fp32" | "fp16" | "q8" | "q4" | "q4f16" = (process.env.ULTRON_KOKORO_DTYPE as "q8") ?? "q8",
  ) {}

  status(): TtsStatus {
    return this.state;
  }

  async prepare(): Promise<void> {
    await this.load();
  }

  private load(): Promise<Kokoro> {
    if (this.tts) return Promise.resolve(this.tts);
    if (this.loading) return this.loading;
    this.state = { state: "loading", detail: "Loading the voice…", progress: 0 };
    const files = new Map<string, { loaded: number; total: number }>();
    this.loading = (async () => {
      mkdirSync(this.cacheDir, { recursive: true });
      const [{ KokoroTTS }, transformers] = await Promise.all([import("kokoro-js"), import("@huggingface/transformers")]);
      transformers.env.cacheDir = this.cacheDir;
      return (await KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: this.dtype,
        device: "cpu",
        progress_callback: (p: any) => {
          if (p.status === "progress" && p.total) {
            files.set(p.file, { loaded: p.loaded, total: p.total });
            const all = [...files.values()];
            const pct = (100 * all.reduce((a, f) => a + f.loaded, 0)) / all.reduce((a, f) => a + f.total, 0);
            this.state = { state: "loading", detail: "Downloading the voice (one time only)…", progress: Math.round(pct) };
          }
        },
      })) as unknown as Kokoro;
    })();
    return this.loading.then(
      (t) => {
        this.tts = t;
        this.state = { state: "ready", detail: "Local voice loaded." };
        return t;
      },
      (err: Error) => {
        this.loading = null;
        this.state = {
          state: "error",
          detail: /fetch|network|ENOTFOUND|ECONN|403|404/i.test(err.message)
            ? "Couldn't download the voice. Check your internet connection (only needed once), then try again."
            : `The voice failed to load: ${err.message}`,
        };
        throw new TtsError(this.state.detail, "unavailable");
      },
    );
  }

  async synthesize(text: string, voice: string, speed: number) {
    const tts = await this.load();
    const v = KOKORO_VOICES.some((x) => x.id === voice) ? voice : "bm_george";
    const run = this.queue.then(() => tts.generate(text, { voice: v, speed }));
    this.queue = run.catch(() => {});
    try {
      const out = await run;
      return { samples: out.audio, sampleRate: out.sampling_rate };
    } catch (err) {
      throw new TtsError(`Speech generation failed: ${(err as Error).message}`, "failed");
    }
  }
}
