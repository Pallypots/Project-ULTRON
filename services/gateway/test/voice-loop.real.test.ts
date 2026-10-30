// Real local voice round trip: Kokoro speaks a sentence, Whisper listens to it, the words must match.
// Downloads both models, so only runs with ULTRON_TEST_TTS=1 (CI).
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resample, rms } from "@ultron/audio";
import { KokoroEngine } from "../src/tts/kokoro.ts";
import { LocalWhisperEngine } from "../src/stt/local-whisper.ts";

const enabled = process.env.ULTRON_TEST_TTS === "1";
const dir = process.env.ULTRON_TEST_MODEL_DIR ?? join(tmpdir(), "ultron-test-models");

describe.skipIf(!enabled)("local voice round trip (Kokoro → Whisper)", () => {
  it("speaks a sentence that Whisper transcribes back correctly", async () => {
    const tts = new KokoroEngine(dir);
    const t0 = Date.now();
    await tts.prepare();
    const loadMs = Date.now() - t0;
    const sentence = "Good evening. The reactor is stable and all systems are running locally.";
    const t1 = Date.now();
    const { samples, sampleRate } = await tts.synthesize(sentence, "bm_george", 1);
    const genMs = Date.now() - t1;
    const seconds = samples.length / sampleRate;
    expect(seconds).toBeGreaterThan(2);
    expect(rms(samples)).toBeGreaterThan(0.01);

    const stt = new LocalWhisperEngine(dir);
    const heard = (await stt.transcribe(resample(samples, sampleRate))).toLowerCase();
    const summary = `kokoro load=${loadMs}ms generate=${genMs}ms for ${seconds.toFixed(1)}s audio (RTF ${(genMs / 1000 / seconds).toFixed(2)}); whisper heard="${heard}"`;
    console.log(`[voice-loop] ${summary}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Local voice round trip (${process.platform})::${summary}`);
    for (const w of ["evening", "reactor", "stable", "systems", "locally"]) expect(heard).toContain(w);
  }, 900_000);
});
