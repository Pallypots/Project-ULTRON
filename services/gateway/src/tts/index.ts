import { join } from "node:path";
import type { PreferenceStore } from "@ultron/memory";
import { KokoroEngine } from "./kokoro.ts";
import type { TtsEngine, TtsEngineId, TtsStatus } from "./types.ts";

export * from "./types.ts";
export { KOKORO_VOICES } from "./kokoro.ts";

export interface TtsSettings {
  engine: TtsEngineId;
  voice: string;
  speed: number;
}

/** Deterministic test engine: a soft tone whose length follows the text, so playback paths can be tested. */
class MockTtsEngine implements TtsEngine {
  readonly id = "mock";
  readonly voices = [{ id: "mock", name: "Test tone", accent: "British" as const, gender: "Male" as const, quality: "-" }];
  status(): TtsStatus {
    return { state: "ready", detail: "Test voice (plays a tone)" };
  }
  async prepare() {}
  async synthesize(text: string, _voice: string, speed: number) {
    const sampleRate = 24000;
    const seconds = Math.min(8, 0.25 + (text.length * 0.045) / speed);
    const samples = Float32Array.from({ length: Math.round(sampleRate * seconds) }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / sampleRate) * Math.min(1, i / 2400));
    return { samples, sampleRate };
  }
}

export class TtsManager {
  private kokoro: KokoroEngine;
  private mock = new MockTtsEngine();

  constructor(
    dataDir: string,
    private prefs: PreferenceStore,
  ) {
    this.kokoro = new KokoroEngine(join(dataDir, "models"));
  }

  settings(): TtsSettings {
    return this.prefs.get<TtsSettings>("tts", { engine: (process.env.ULTRON_TTS_ENGINE as TtsEngineId) ?? "local", voice: "bm_george", speed: 1 });
  }

  /** The server-side engine; null when the browser's own voices are used. */
  current(): TtsEngine | null {
    const e = this.settings().engine;
    return e === "mock" ? this.mock : e === "local" ? this.kokoro : null;
  }
}
