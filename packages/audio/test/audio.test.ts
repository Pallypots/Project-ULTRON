import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeWav, encodeWav, resample, rms, WavError } from "../src/index.ts";

const tone = (rate: number, seconds: number) => Float32Array.from({ length: rate * seconds }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));

describe("wav", () => {
  it("round-trips encode/decode at 16 kHz", () => {
    const input = tone(16000, 1);
    const { samples, seconds } = decodeWav(encodeWav(input));
    expect(seconds).toBeCloseTo(1, 3);
    expect(Math.max(...samples.map((s, i) => Math.abs(s - input[i]!)))).toBeLessThan(1e-3);
  });

  it("downmixes stereo and resamples 48 kHz to 16 kHz", () => {
    const rate = 48000;
    const frames = rate / 2;
    const buf = new ArrayBuffer(44 + frames * 4);
    const v = new DataView(buf);
    const head = encodeWav(new Float32Array(0), rate);
    new Uint8Array(buf).set(head.subarray(0, 44));
    v.setUint16(22, 2, true);
    v.setUint32(28, rate * 4, true);
    v.setUint16(32, 4, true);
    v.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames * 2; i++) v.setInt16(44 + i * 2, 8000, true);
    const out = decodeWav(new Uint8Array(buf));
    expect(out.seconds).toBeCloseTo(0.5, 2);
    expect(out.samples[100]).toBeCloseTo(8000 / 0x8000, 3);
  });

  it("reads the real speech fixture", () => {
    const { seconds, samples } = decodeWav(readFileSync(join(import.meta.dirname, "../../../services/gateway/test/fixtures/jfk.wav")));
    expect(seconds).toBeGreaterThan(10);
    expect(rms(samples)).toBeGreaterThan(0.01);
  });

  it("rejects garbage and unsupported encodings", () => {
    expect(() => decodeWav(new TextEncoder().encode("definitely not audio, just some text"))).toThrow(WavError);
    const bad = encodeWav(tone(16000, 0.1));
    new DataView(bad.buffer).setUint16(34, 8, true);
    expect(() => decodeWav(bad)).toThrow(/Unsupported/);
  });

  it("resample keeps duration and rms detects silence", () => {
    expect(resample(tone(44100, 1), 44100).length).toBe(16000);
    expect(rms(new Float32Array(1000))).toBe(0);
  });
});
