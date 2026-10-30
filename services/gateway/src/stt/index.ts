import { join } from "node:path";
import type { PreferenceStore } from "@ultron/memory";
import type { SecretStore } from "../secrets.ts";
import { DEFAULT_LOCAL_MODEL, LocalWhisperEngine } from "./local-whisper.ts";
import { MockSttEngine } from "./mock.ts";
import { OpenAISttEngine } from "./openai.ts";
import type { SttEngine, SttEngineId } from "./types.ts";

export * from "./types.ts";
export { DEFAULT_LOCAL_MODEL } from "./local-whisper.ts";

export interface VoiceSettings {
  engine: SttEngineId;
  model: string;
}

export function readVoiceSettings(prefs: PreferenceStore): VoiceSettings {
  return prefs.get<VoiceSettings>("voice", { engine: (process.env.ULTRON_STT_ENGINE as SttEngineId) ?? "local", model: process.env.ULTRON_STT_MODEL ?? "" });
}

/** Keeps one engine instance per (engine, model) so a loaded local model stays in memory. */
export class SttManager {
  private cache = new Map<string, SttEngine>();

  constructor(
    private dataDir: string,
    private prefs: PreferenceStore,
    private secrets: SecretStore,
  ) {}

  settings(): VoiceSettings {
    return readVoiceSettings(this.prefs);
  }

  current(): SttEngine {
    const s = this.settings();
    const key = `${s.engine}:${s.model}:${s.engine === "openai" ? this.secrets.has("OPENAI_API_KEY") : ""}`;
    let engine = this.cache.get(key);
    if (!engine) {
      engine =
        s.engine === "mock"
          ? new MockSttEngine()
          : s.engine === "openai"
            ? new OpenAISttEngine(this.secrets.get("OPENAI_API_KEY"), s.model)
            : new LocalWhisperEngine(join(this.dataDir, "models"), s.model || DEFAULT_LOCAL_MODEL);
      this.cache.set(key, engine);
    }
    return engine;
  }
}
