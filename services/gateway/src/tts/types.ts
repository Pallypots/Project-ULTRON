export type TtsEngineId = "local" | "browser" | "mock";

export interface TtsVoice {
  id: string;
  name: string;
  accent: "British" | "American";
  gender: "Male" | "Female";
  quality: string;
}

export interface TtsStatus {
  state: "ready" | "not_loaded" | "loading" | "error";
  detail: string;
  progress?: number;
}

export interface TtsEngine {
  readonly id: TtsEngineId;
  readonly voices: TtsVoice[];
  status(): TtsStatus;
  prepare(): Promise<void>;
  /** Returns mono float samples and their sample rate. */
  synthesize(text: string, voice: string, speed: number): Promise<{ samples: Float32Array; sampleRate: number }>;
}

export class TtsError extends Error {
  constructor(
    message: string,
    readonly code: "unavailable" | "failed" | "bad_request",
  ) {
    super(message);
  }
}
