import { ModelProcess } from "../models/process.ts";
import { SttError, type SttEngine, type SttStatus } from "./types.ts";

export const DEFAULT_LOCAL_MODEL = "Xenova/whisper-base.en";

/**
 * Whisper running on this computer via transformers.js (ONNX Runtime). Audio never leaves the PC.
 * The model (~150-300 MB) downloads from Hugging Face on first use into <data>/models, then works offline.
 */
export class LocalWhisperEngine implements SttEngine {
  readonly id = "local";
  readonly privacy = "Speech is recognized on this computer. Audio never leaves it (the model downloads once from Hugging Face).";
  private loading: Promise<void> | null = null;
  private loaded = false;
  private state: SttStatus = { state: "not_loaded", detail: "The speech model loads the first time you use voice (one-time download)." };
  /** The model runs in its own process: the service stays responsive, and a crash there can't take ULTRON down. */
  readonly host = new ModelProcess("speech recognition");

  constructor(
    private cacheDir: string,
    readonly model = DEFAULT_LOCAL_MODEL,
  ) {
    this.host.onProgress = (pct) => (this.state = { state: "loading", detail: "Downloading the speech model (one time only)…", progress: pct });
    this.host.onCrash = () => {
      this.loaded = false;
      this.loading = null;
      this.state = { state: "not_loaded", detail: "The speech model restarted; it reloads on next use." };
    };
  }

  status(): SttStatus {
    return this.state;
  }

  async prepare(): Promise<void> {
    await this.load();
  }

  private load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    this.state = { state: "loading", detail: "Loading the speech model…", progress: 0 };
    this.loading = this.host.request<{ ok: boolean }>({ kind: "stt.load", model: this.model, cacheDir: this.cacheDir }, 30 * 60_000).then(
      () => {
        this.loaded = true;
        this.state = { state: "ready", detail: `Speech model ${this.model} is loaded.` };
      },
      (err: Error) => {
        this.loading = null;
        const offline = /fetch|network|ENOTFOUND|ECONN|403|404/i.test(err.message);
        const missing = /Cannot find (?:module|package)/i.test(err.message);
        this.state = {
          state: "error",
          detail: missing
            ? "The local speech engine isn't installed. Run `npm install` in the ULTRON folder."
            : offline
              ? "Couldn't download the speech model. Check your internet connection (only needed once), then try again."
              : `The speech model failed to load: ${err.message}`,
        };
        throw new SttError(this.state.detail, "unavailable");
      },
    );
    return this.loading;
  }

  async transcribe(samples: Float32Array): Promise<string> {
    await this.load();
    try {
      const out = await this.host.request<{ text: string }>({ kind: "stt.run", samples }, 120_000);
      return out.text;
    } catch (err) {
      throw new SttError(`Speech recognition failed: ${(err as Error).message}`, "failed");
    }
  }
}
