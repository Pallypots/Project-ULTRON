import { mkdirSync } from "node:fs";
import { SttError, type SttEngine, type SttStatus } from "./types.ts";

export const DEFAULT_LOCAL_MODEL = "Xenova/whisper-base.en";

type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

/**
 * Whisper running on this computer via transformers.js (ONNX Runtime). Audio never leaves the PC.
 * The model (~150-300 MB) downloads from Hugging Face on first use into <data>/models, then works offline.
 */
export class LocalWhisperEngine implements SttEngine {
  readonly id = "local";
  readonly privacy = "Speech is recognized on this computer. Audio never leaves it (the model downloads once from Hugging Face).";
  private loading: Promise<Transcriber> | null = null;
  private transcriber: Transcriber | null = null;
  private state: SttStatus = { state: "not_loaded", detail: "The speech model loads the first time you use voice (one-time download)." };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private cacheDir: string,
    readonly model = DEFAULT_LOCAL_MODEL,
  ) {}

  status(): SttStatus {
    return this.state;
  }

  async prepare(): Promise<void> {
    await this.load();
  }

  private load(): Promise<Transcriber> {
    if (this.transcriber) return Promise.resolve(this.transcriber);
    if (this.loading) return this.loading;
    this.state = { state: "loading", detail: "Loading the speech model…", progress: 0 };
    const files = new Map<string, { loaded: number; total: number }>();
    this.loading = (async () => {
      mkdirSync(this.cacheDir, { recursive: true });
      let lib: typeof import("@huggingface/transformers");
      try {
        lib = await import("@huggingface/transformers");
      } catch {
        throw new SttError("The local speech engine isn't installed. Run `npm install` in the ULTRON folder.", "unavailable");
      }
      lib.env.cacheDir = this.cacheDir;
      const pipe = await lib.pipeline("automatic-speech-recognition", this.model, {
        cache_dir: this.cacheDir,
        progress_callback: (p: any) => {
          if (p.status === "progress" && p.total) {
            files.set(p.file, { loaded: p.loaded, total: p.total });
            const all = [...files.values()];
            const pct = (100 * all.reduce((a, f) => a + f.loaded, 0)) / all.reduce((a, f) => a + f.total, 0);
            this.state = { state: "loading", detail: "Downloading the speech model (one time only)…", progress: Math.round(pct) };
          }
        },
      });
      return pipe as unknown as Transcriber;
    })();
    return this.loading.then(
      (t) => {
        this.transcriber = t;
        this.state = { state: "ready", detail: `Speech model ${this.model} is loaded.` };
        return t;
      },
      (err: Error) => {
        this.loading = null;
        const offline = /fetch|network|ENOTFOUND|ECONN|403|404/i.test(err.message);
        this.state = {
          state: "error",
          detail: offline
            ? "Couldn't download the speech model. Check your internet connection (only needed once), then try again."
            : `The speech model failed to load: ${err.message}`,
        };
        throw err instanceof SttError ? err : new SttError(this.state.detail, "unavailable");
      },
    );
  }

  async transcribe(samples: Float32Array): Promise<string> {
    const t = await this.load();
    // One transcription at a time keeps memory use predictable.
    const run = this.queue.then(() => t(samples, { chunk_length_s: 30, stride_length_s: 5 }));
    this.queue = run.catch(() => {});
    try {
      const out = await run;
      return (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
    } catch (err) {
      throw new SttError(`Speech recognition failed: ${(err as Error).message}`, "failed");
    }
  }
}
