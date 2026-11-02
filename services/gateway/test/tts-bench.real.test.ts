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
  it("measures speed and intelligibility per precision (medians of interleaved rounds)", async () => {
    const stt = new LocalWhisperEngine(dir);
    const kinds = ["q8", "fp32", "fp16", "q4"] as const;
    const engines = new Map<string, KokoroEngine>();
    const res = new Map<string, { opener: number[]; rtf: number[]; ok: boolean; err?: string }>();
    for (const dtype of kinds) {
      try {
        const tts = new KokoroEngine(dir, dtype);
        await tts.prepare();
        await tts.synthesize("Warm up.", "bm_george", 1);
        const { samples, sampleRate } = await tts.synthesize(SENTENCE, "bm_george", 1);
        const heard = (await stt.transcribe(resample(samples, sampleRate))).toLowerCase();
        engines.set(dtype, tts);
        res.set(dtype, { opener: [], rtf: [], ok: ["systems", "locally", "reminder"].every((w) => heard.includes(w)) });
      } catch (err) {
        res.set(dtype, { opener: [], rtf: [], ok: false, err: (err as Error).message.slice(0, 80) });
      }
    }
    stt.host.stop();
    // Rounds take turns between precisions, so a busy moment on the machine doesn't land on just one of them.
    for (let round = 0; round < 5; round++)
      for (const [dtype, tts] of engines) {
        const r = res.get(dtype)!;
        let t = Date.now();
        await tts.synthesize("Right away.", "bm_george", 1); // the first short chunk the owner waits for
        r.opener.push(Date.now() - t);
        t = Date.now();
        const { samples, sampleRate } = await tts.synthesize(SENTENCE, "bm_george", 1);
        r.rtf.push((Date.now() - t) / 1000 / (samples.length / sampleRate));
      }
    for (const tts of engines.values()) tts.host.stop();
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? NaN;
    const rows = kinds.map((k) => {
      const r = res.get(k)!;
      return r.err ? `${k}: failed (${r.err})` : `${k}: short opener ${Math.round(med(r.opener))} ms (range ${Math.min(...r.opener)}-${Math.max(...r.opener)}), RTF ${med(r.rtf).toFixed(2)}, ${r.ok ? "intelligible" : "UNCLEAR"}`;
    });
    const summary = rows.join(" | ");
    console.log(`[kokoro-bench] ${summary}`);
    ciNote("Kokoro precision benchmark", summary);
    expect(rows.some((r) => r.includes("intelligible"))).toBe(true);
  }, 2_400_000);
});
