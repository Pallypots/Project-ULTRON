// Benchmarks Kokoro precisions on this machine (speed = real-time factor; < 1 means faster than speaking) and checks
// each one still produces words Whisper can understand. CI-only (ULTRON_TEST_TTS_BENCH=1): downloads several model files.
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resample } from "@ultron/audio";
import { KokoroEngine } from "../src/tts/kokoro.ts";
import { LocalWhisperEngine } from "../src/stt/local-whisper.ts";
import { ciNote } from "./helpers.ts";

const enabled = process.env.ULTRON_TEST_TTS_BENCH === "1";
const dir = process.env.ULTRON_TEST_MODEL_DIR ?? join(tmpdir(), "ultron-test-models");
const SENTENCE = "All systems are running locally, and your next reminder is at five o'clock.";

describe.skipIf(!enabled)("Kokoro precision benchmark", () => {
  it("measures speed and intelligibility per precision", async () => {
    const stt = new LocalWhisperEngine(dir);
    const rows: string[] = [];
    for (const dtype of ["q8", "fp32", "fp16", "q4"] as const) {
      try {
        const tts = new KokoroEngine(dir, dtype);
        await tts.prepare();
        await tts.synthesize("Warm up.", "bm_george", 1);
        const t = Date.now();
        const { samples, sampleRate } = await tts.synthesize(SENTENCE, "bm_george", 1);
        const secs = samples.length / sampleRate;
        const rtf = (Date.now() - t) / 1000 / secs;
        const heard = (await stt.transcribe(resample(samples, sampleRate))).toLowerCase();
        const ok = ["systems", "locally", "reminder"].every((w) => heard.includes(w));
        // What the owner waits for: the first short chunk of a reply ("Right away.").
        const t2 = Date.now();
        await tts.synthesize("Right away.", "bm_george", 1);
        const first = Date.now() - t2;
        rows.push(`${dtype}: RTF ${rtf.toFixed(2)}, short opener ${first} ms, ${ok ? "intelligible" : `UNCLEAR ("${heard}")`}`);
        tts.host.stop();
      } catch (err) {
        rows.push(`${dtype}: failed (${(err as Error).message.slice(0, 80)})`);
      }
    }
    stt.host.stop();
    const summary = rows.join(" | ");
    console.log(`[kokoro-bench] ${summary}`);
    ciNote("Kokoro precision benchmark", summary);
    expect(rows.some((r) => r.includes("intelligible"))).toBe(true);
  }, 1_800_000);
});
