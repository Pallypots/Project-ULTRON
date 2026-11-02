// The wake-word detector on real speech: "Ultron" said by the on-PC voice in several voices (positives), and everyday
// sentences without it, including near-misses like "ultimate" and "patron" (negatives). Needs the voice model, so it
// runs only with ULTRON_TEST_TTS=1 (CI).
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { resample } from "@ultron/audio";
import { KokoroEngine } from "../src/tts/kokoro.ts";
import { WakeSpotter } from "../src/voice/kws.ts";
import { ciNote } from "./helpers.ts";

const enabled = process.env.ULTRON_TEST_TTS === "1";
const modelDir = process.env.ULTRON_TEST_MODEL_DIR ?? join(tmpdir(), "ultron-test-models");

const POSITIVE = ["Ultron, what time is it?", "Hey Ultron, turn the lights on.", "Ultron.", "Okay Ultron, play some music.", "So Ultron, what do you think?"];
const NEGATIVE = [
  "I was telling my sister about the weather yesterday.",
  "The ultimate question is what we have for dinner.",
  "Patrons of the arts gathered in the hall.",
  "Turn on the lights, please.",
  "All right, let's go to the shops.",
];
const VOICES = ["bm_george", "af_heart", "am_michael", "bf_emma"];

describe.skipIf(!enabled)("wake-word detector on real speech", () => {
  it("hears 'Ultron' in different voices and ignores sentences without it", async () => {
    const kokoro = new KokoroEngine(modelDir);
    const spotter = new WakeSpotter();
    const results: { text: string; voice: string; hit: boolean; ms: number }[] = [];
    try {
      for (const voice of VOICES)
        for (const text of [...POSITIVE, ...NEGATIVE]) {
          const { samples, sampleRate } = await kokoro.synthesize(text, voice, 1);
          const t = Date.now();
          const r = await spotter.spot(resample(samples, sampleRate), ["Ultron"]);
          results.push({ text, voice, hit: Boolean(r?.hit), ms: Date.now() - t });
        }
    } finally {
      kokoro.host.stop();
      spotter.host.stop();
    }
    const pos = results.filter((r) => POSITIVE.includes(r.text));
    const neg = results.filter((r) => NEGATIVE.includes(r.text));
    const found = pos.filter((r) => r.hit).length;
    const falseAlarms = neg.filter((r) => r.hit);
    const ms = results.slice(1).map((r) => r.ms).sort((a, b) => a - b);
    ciNote(
      "Wake-word detector on real speech",
      `heard "Ultron" ${found}/${pos.length} | false alarms ${falseAlarms.length}/${neg.length}${falseAlarms.length ? ` (${falseAlarms.map((r) => `${r.voice}: ${r.text}`).join("; ")})` : ""} | missed: ${pos.filter((r) => !r.hit).map((r) => `${r.voice}: ${r.text}`).join("; ") || "none"} | per phrase median ${ms[Math.floor(ms.length / 2)]} ms`,
    );
    expect(found / pos.length).toBeGreaterThanOrEqual(0.8);
    expect(falseAlarms.length).toBeLessThanOrEqual(1);
  }, 1_200_000);
});
