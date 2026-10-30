export type SttEngineId = "local" | "openai" | "mock";

export interface SttStatus {
  /** ready: can transcribe now · not_loaded: will load (and download if needed) on first use · loading · error · not_configured */
  state: "ready" | "not_loaded" | "loading" | "error" | "not_configured";
  detail: string;
  /** 0-100 while a model download is in progress. */
  progress?: number;
}

export interface SttEngine {
  readonly id: SttEngineId;
  readonly model: string;
  /** Where the audio goes, shown to the owner before they talk. */
  readonly privacy: string;
  status(): SttStatus;
  /** Load (downloading if needed) so the first push-to-talk isn't slow. Safe to call repeatedly. */
  prepare(): Promise<void>;
  /** 16 kHz mono float samples in, text out. */
  transcribe(samples: Float32Array, wav: Uint8Array): Promise<string>;
}

export class SttError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "unavailable" | "bad_audio" | "failed",
  ) {
    super(message);
  }
}
