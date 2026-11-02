// Phase 2.4 A/B: is there a faster on-PC speech recogniser that's at least as accurate as Whisper base.en?
// Same audio for every model: the JFK sample plus short commands spoken by the on-PC voice in two voices.
// Records accuracy (word error rate) and time per phrase; no pass/fail on speed. Needs model downloads, so it runs
// only with ULTRON_TEST_TTS=1 and ULTRON_TEST_WHISPER=1 (CI).
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeWav, resample } from "@ultron/audio";
import { LocalWhisperEngine } from "../src/stt/local-whisper.ts";
import { KokoroEngine } from "../src/tts/kokoro.ts";
import { ciNote } from "./helpers.ts";

const enabled = process.env.ULTRON_TEST_TTS === "1" && process.env.ULTRON_TEST_WHISPER === "1";
const modelDir = process.env.ULTRON_TEST_MODEL_DIR ?? join(tmpdir(), "ultron-test-models");
const MODELS = ["Xenova/whisper-base.en", "onnx-community/moonshine-tiny-ONNX", "onnx-community/moonshine-base-ONNX"];
const COMMANDS = ["Set a timer for ten minutes.", "What's the weather like tomorrow?", "Turn off the living room lights.", "Remind me to call my sister at six.", "How much is fifteen percent of eighty?"];

const NUMBERS: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", eighty: "80", hundred: "100" };
// Same meaning, different spelling ("ten" vs "10", "15%" vs "fifteen percent") isn't an error.
const words = (s: string) =>
  s.toLowerCase().replace(/%/g, " percent").replace(/(\d)(am|pm)\b/g, "$1 $2").replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean).map((w) => NUMBERS[w] ?? w);
/** Word error rate: edits needed to turn what was heard into what was said, per word said. */
export function wer(said: string, heard: string): number {
  const a = words(said);
  const b = words(heard);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]! / Math.max(1, a.length);
}

describe.skipIf(!enabled)("speech recogniser A/B (real models)", () => {
  it("measures accuracy and speed of each candidate on the same audio", async () => {
    const kokoro = new KokoroEngine(modelDir);
    const clips: { said: string; samples: Float32Array }[] = [
      { said: "And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.", samples: decodeWav(readFileSync(join(import.meta.dirname, "fixtures/jfk.wav"))).samples },
    ];
    for (const voice of ["bm_george", "af_heart"])
      for (const said of COMMANDS) {
        const { samples, sampleRate } = await kokoro.synthesize(said, voice, 1);
        clips.push({ said, samples: resample(samples, sampleRate) });
      }
    kokoro.host.stop();
    const lines: string[] = [];
    for (const model of MODELS) {
      const engine = new LocalWhisperEngine(modelDir, model);
      try {
        const t0 = Date.now();
        await engine.prepare();
        const load = Date.now() - t0;
        let errs = 0;
        const times: number[] = [];
        const misheard: string[] = [];
        for (const c of clips) {
          const t = Date.now();
          const heard = await engine.transcribe(c.samples);
          times.push(Date.now() - t);
          const e = wer(c.said, heard);
          errs += e;
          if (e > 0) misheard.push(`"${heard.trim().slice(0, 60)}"`);
        }
        // Negative control: fan-like noise should come out as nothing (or something the noise filter drops).
        const noise = await engine.transcribe(Float32Array.from({ length: 48000 }, () => (Math.random() * 2 - 1) * 0.05));
        times.sort((a, b) => a - b);
        lines.push(`${model}: WER ${((100 * errs) / clips.length).toFixed(1)}% | median ${times[Math.floor(times.length / 2)]} ms per phrase | load ${load} ms | noise → "${noise.slice(0, 40)}" | misheard: ${misheard.join(", ") || "none"}`);
      } catch (err) {
        lines.push(`${model}: couldn't run (${(err as Error).message.slice(0, 120)})`);
      } finally {
        engine.host.stop();
      }
    }
    ciNote("Speech recogniser A/B", lines.join(" || "));
    expect(lines[0]).toMatch(/WER/); // the current model must at least run
  }, 1_800_000);
});
