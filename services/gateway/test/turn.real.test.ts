// Phase 2.3: does Smart Turn tell a finished request from one that trails off? Complete sentences and cut-off fragments
// spoken by the on-PC voice (two voices), plus the JFK speech. Records the probabilities for both ways of padding the
// audio (so we use the one that matches how the model was trained). Needs model downloads: ULTRON_TEST_TTS=1 (CI).
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeWav, resample } from "@ultron/audio";
import { ModelProcess } from "../src/models/process.ts";
import { KokoroEngine } from "../src/tts/kokoro.ts";
import { ciNote } from "./helpers.ts";

const enabled = process.env.ULTRON_TEST_TTS === "1";
const modelDir = process.env.ULTRON_TEST_MODEL_DIR ?? join(tmpdir(), "ultron-test-models");
const COMPLETE = ["What's the weather like tomorrow?", "Set a timer for ten minutes.", "Turn off the lights in the kitchen.", "Tell me a joke."];
const CUT_OFF = ["Set a timer for", "Can you tell me about the", "I was thinking that maybe we could", "Remind me to call my"];

describe.skipIf(!enabled)("Smart Turn on real speech", () => {
  it("scores finished requests higher than cut-off ones", async () => {
    const kokoro = new KokoroEngine(modelDir);
    const clips: { text: string; done: boolean; samples: Float32Array }[] = [];
    for (const voice of ["bm_george", "af_heart"])
      for (const [list, done] of [[COMPLETE, true], [CUT_OFF, false]] as const)
        for (const text of list) {
          const { samples, sampleRate } = await kokoro.synthesize(text, voice, 1);
          clips.push({ text: `${voice}: ${text}`, done, samples: resample(samples, sampleRate) });
        }
    kokoro.host.stop();
    clips.push({ text: "JFK", done: true, samples: decodeWav(readFileSync(join(import.meta.dirname, "fixtures/jfk.wav"))).samples });
    const host = new ModelProcess("turn detector");
    const lines: string[] = [];
    let best = { gap: -Infinity, padLeft: true };
    try {
      for (const padLeft of [true, false]) {
        const scored: { text: string; done: boolean; p: number; ms: number }[] = [];
        let file = "";
        for (const c of clips) {
          const t = Date.now();
          const r = await host.request<{ complete: number; file: string; inputs: string[] }>({ kind: "turn.run", samples: c.samples, cacheDir: modelDir, padLeft }, 120_000);
          file = `${r.file} ${JSON.stringify(r.inputs)}`;
          scored.push({ ...c, p: r.complete, ms: Date.now() - t });
        }
        const avg = (done: boolean) => scored.filter((s) => s.done === done).reduce((a, s) => a + s.p, 0) / scored.filter((s) => s.done === done).length;
        const right = scored.filter((s) => (s.p >= 0.5) === s.done).length;
        const gap = avg(true) - avg(false);
        if (gap > best.gap) best = { gap, padLeft };
        const ms = scored.slice(1).map((s) => s.ms).sort((a, b) => a - b);
        lines.push(`pad ${padLeft ? "start" : "end"} (${file}): ${right}/${scored.length} right | finished avg ${avg(true).toFixed(2)}, cut-off avg ${avg(false).toFixed(2)} | median ${ms[Math.floor(ms.length / 2)]} ms | ${scored.map((s) => `${s.text.slice(0, 28)}=${s.p.toFixed(2)}`).join(", ")}`);
      }
    } finally {
      host.stop();
    }
    ciNote("Smart Turn on real speech", `${lines.join(" || ")} || better padding: ${best.padLeft ? "start" : "end"}`);
    expect(lines).toHaveLength(2);
  }, 1_200_000);
});
