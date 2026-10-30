import { rms } from "@ultron/audio";
import type { SttEngine, SttStatus } from "./types.ts";

/** Deterministic engine for tests and demos: describes the audio it received instead of recognizing words. */
export class MockSttEngine implements SttEngine {
  readonly id = "mock";
  readonly model = "mock-stt";
  readonly privacy = "Test engine: audio is measured, not recognized, and never leaves this computer.";
  status(): SttStatus {
    return { state: "ready", detail: "Test speech engine (does not recognize words)" };
  }
  async prepare(): Promise<void> {}
  async transcribe(samples: Float32Array): Promise<string> {
    // Tests can prefix a wake word (e.g. "Ultron, ") to exercise hands-free mode end to end.
    return `${process.env.ULTRON_MOCK_TRANSCRIPT_PREFIX ?? ""}Mock transcript of ${(samples.length / 16000).toFixed(1)} seconds of audio at level ${rms(samples).toFixed(3)}`;
  }
}
