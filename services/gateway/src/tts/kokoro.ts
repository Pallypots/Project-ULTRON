import { ModelProcess } from "../models/process.ts";
import { isRestart } from "../stt/local-whisper.ts";
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

/**
 * Kokoro-82M (Apache-2.0) running on this computer via kokoro-js + ONNX Runtime, in its own process (see models/host.ts).
 * The ~90 MB model downloads once from Hugging Face into <data>/models; voices ship with the package.
 */
export class KokoroEngine implements TtsEngine {
  readonly id = "local";
  readonly voices = KOKORO_VOICES;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private state: TtsStatus = { state: "not_loaded", detail: "The voice downloads the first time ULTRON speaks (about 165 MB, one time)." };
  readonly host = new ModelProcess("voice");

  constructor(
    private cacheDir: string,
    // fp16 benchmarked fastest-for-size on CPU in CI (RTF ~0.8 on Windows and Linux vs ~1.4–2.0 for q8); see docs/VOICE.md.
    readonly dtype: "fp32" | "fp16" | "q8" | "q4" | "q4f16" = (process.env.ULTRON_KOKORO_DTYPE as "fp16") ?? "fp16",
  ) {
    this.host.onProgress = (pct) => (this.state = { state: "loading", detail: "Downloading the voice (one time only)…", progress: pct });
    this.host.onCrash = () => {
      this.loaded = false;
      this.loading = null;
      this.state = { state: "not_loaded", detail: "The voice restarted; it reloads on next use." };
    };
  }

  status(): TtsStatus {
    return this.state;
  }

  async prepare(): Promise<void> {
    await this.load();
  }

  private load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    this.state = { state: "loading", detail: "Loading the voice…", progress: 0 };
    this.loading = this.host.request({ kind: "tts.load", dtype: this.dtype, model: KOKORO_MODEL, cacheDir: this.cacheDir }, 30 * 60_000).then(
      () => {
        this.loaded = true;
        this.state = { state: "ready", detail: "Local voice loaded." };
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
    return this.loading;
  }

  async synthesize(text: string, voice: string, speed: number, signal?: AbortSignal) {
    await this.load();
    const v = KOKORO_VOICES.some((x) => x.id === voice) ? voice : "bm_george";
    for (let attempt = 0; ; attempt++) {
      if (attempt) await this.load();
      try {
        const out = await this.host.request<{ audio: Float32Array; rate: number }>({ kind: "tts.run", text, voice: v, speed }, 120_000, signal);
        return { samples: out.audio, sampleRate: out.rate };
      } catch (err) {
        if ((err as Error).name === "AbortError") throw new TtsError("cancelled", "cancelled");
        if (attempt === 0 && isRestart(err)) continue; // the voice process died: restart it and say it once more
        throw new TtsError(`Speech generation failed: ${(err as Error).message}`, "failed");
      }
    }
  }
}
