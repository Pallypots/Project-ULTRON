import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { decodeWav, isSpeech, SileroVad, StreamResampler, type OrtLike } from "../src/index.ts";

const require = createRequire(new URL("../../../services/gateway/package.json", import.meta.url));
const ort = require("onnxruntime-node") as OrtLike;
const MODEL = new URL("../../../models/vad/silero_vad_v6.onnx", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const speech = decodeWav(readFileSync(new URL("../../../services/gateway/test/fixtures/jfk.wav", import.meta.url))).samples;

/** Fraction of 32 ms windows the detector calls speech, fed in 20 ms browser-sized pieces through the resampler. */
async function speechShare(samples16k: Float32Array, rate = 16000): Promise<number> {
  const vad = await SileroVad.load(ort, MODEL);
  // Simulate the microphone at `rate`: upsample, then stream back down in 20 ms frames like the app does.
  const up = new Float32Array(Math.floor((samples16k.length * rate) / 16000));
  for (let i = 0; i < up.length; i++) up[i] = samples16k[Math.min(samples16k.length - 1, Math.floor((i * 16000) / rate))]!;
  const rs = new StreamResampler(rate);
  const frame = Math.round(rate * 0.02);
  let on = false;
  let hits = 0;
  let total = 0;
  for (let i = 0; i < up.length; i += frame) {
    await vad.feed(rs.push(up.subarray(i, i + frame)));
    on = isSpeech(vad.probability, on);
    hits += on ? 1 : 0;
    total++;
  }
  return hits / total;
}

let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const secs = (n: number, f: (i: number) => number) => Float32Array.from({ length: 16000 * n }, (_, i) => f(i));

describe("Silero speech detector (2.2)", () => {
  it("positive control: a real voice is detected as speech, through 48 kHz framing and resampling", async () => {
    const share = await speechShare(speech, 48000);
    console.log(`[silero] speech: ${share.toFixed(2)}`);
    expect(share).toBeGreaterThan(0.5);
  }, 60_000);

  it("negative controls: fan noise, mains hum, keyboard clicks, music and silence are not speech", async () => {
    const fan = secs(4, () => rand() * 0.08);
    const hum = secs(4, (i) => 0.2 * Math.sin((2 * Math.PI * 50 * i) / 16000) + 0.1 * Math.sin((2 * Math.PI * 100 * i) / 16000));
    const clicks = secs(4, (i) => (i % 2400 < 40 ? rand() * 0.6 : rand() * 0.003));
    const chord = secs(4, (i) => [261.6, 329.6, 392].reduce((s, f) => s + 0.1 * Math.sin((2 * Math.PI * f * i) / 16000), 0));
    const quiet = secs(3, () => 0);
    for (const [name, a] of Object.entries({ fan, hum, clicks, chord, quiet })) {
      const share = await speechShare(a);
      console.log(`[silero] ${name}: ${share.toFixed(2)}`);
      expect(share, name).toBeLessThan(0.1);
    }
  }, 60_000);

  it("the RMS detector it replaces does trigger on those (so the test can tell them apart)", () => {
    const loud = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length) > 0.012 * 3;
    expect(loud(secs(1, () => rand() * 0.08))).toBe(true);
    expect(loud(secs(1, (i) => 0.2 * Math.sin((2 * Math.PI * 50 * i) / 16000)))).toBe(true);
  });

  it("the streaming resampler matches a whole-buffer resample (no drift or clicks at frame joins)", () => {
    const tone = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
    const rs = new StreamResampler(48000);
    const parts: number[] = [];
    for (let i = 0; i < tone.length; i += 960) parts.push(...rs.push(tone.subarray(i, i + 960)));
    expect(Math.abs(parts.length - 16000)).toBeLessThanOrEqual(2);
    for (let i = 0; i < parts.length; i += 997) expect(parts[i]!).toBeCloseTo(Math.sin((2 * Math.PI * 440 * i * 3) / 48000), 1);
  });
});
