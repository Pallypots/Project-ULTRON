// Real speech recognition with the local Whisper model. Downloads the model (~150-300 MB) on first run,
// so it only runs when ULTRON_TEST_WHISPER=1 (CI sets it). Model cache: ULTRON_TEST_MODEL_DIR or <tmp>.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeWav } from "@ultron/audio";
import { LocalWhisperEngine } from "../src/stt/local-whisper.ts";

const enabled = process.env.ULTRON_TEST_WHISPER === "1";

describe.skipIf(!enabled)("local Whisper engine (real model)", () => {
  it("transcribes the JFK sample accurately", async () => {
    const engine = new LocalWhisperEngine(process.env.ULTRON_TEST_MODEL_DIR ?? join(tmpdir(), "ultron-test-models"));
    const t0 = Date.now();
    await engine.prepare();
    const loadMs = Date.now() - t0;
    expect(engine.status().state).toBe("ready");
    const { samples, seconds } = decodeWav(readFileSync(join(import.meta.dirname, "fixtures/jfk.wav")));
    const t1 = Date.now();
    const text = await engine.transcribe(samples);
    const ms = Date.now() - t1;
    console.log(`[whisper] model=${engine.model} load=${loadMs}ms audio=${seconds.toFixed(1)}s transcribe=${ms}ms text="${text}"`);
    expect(text.toLowerCase()).toMatch(/ask not what your country can do for you/);
    expect(text.toLowerCase()).toMatch(/what you can do for your country/);
  }, 600_000);
});
