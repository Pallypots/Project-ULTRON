// Pure audio helpers shared by the UI (encoding microphone audio) and the gateway (decoding it).
// No DOM or Node APIs, so both sides can use them and tests can run them directly.

export { toSpeakable, SentenceSplitter } from "./speech.ts";

export const TARGET_SAMPLE_RATE = 16_000;

/** Linear-interpolation resampler. Good enough for speech going into a recognizer. */
export function resample(input: Float32Array, fromRate: number, toRate = TARGET_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Encodes mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export class WavError extends Error {}

/** Decodes a PCM16 (or float32) WAV of any channel count/rate into 16 kHz mono floats. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number; seconds: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new WavError("Not a WAV file.");
  let offset = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = v.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt) throw new WavError("WAV data before format chunk.");
      const { format, channels, rate, bits } = fmt;
      const pcm16 = format === 1 && bits === 16;
      const f32 = format === 3 && bits === 32;
      if (!pcm16 && !f32) throw new WavError(`Unsupported WAV encoding (format ${format}, ${bits}-bit). Use 16-bit PCM.`);
      if (channels < 1 || rate < 8000 || rate > 192000) throw new WavError("Unsupported WAV channel count or sample rate.");
      const bytesPer = bits / 8;
      const end = Math.min(body + size, bytes.length);
      const frames = Math.floor((end - body) / (bytesPer * channels));
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * bytesPer;
          sum += pcm16 ? v.getInt16(p, true) / 0x8000 : v.getFloat32(p, true);
        }
        mono[i] = sum / channels;
      }
      const samples = resample(mono, rate);
      return { samples, sampleRate: TARGET_SAMPLE_RATE, seconds: samples.length / TARGET_SAMPLE_RATE };
    }
    offset = body + size + (size % 2);
  }
  throw new WavError("WAV file has no audio data.");
}

/** Root-mean-square loudness, 0..1. Used for silence detection and the HUD level meter. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}
