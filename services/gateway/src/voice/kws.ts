import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../config.ts";
import { ModelProcess } from "../models/process.ts";

export const KWS_DIR = join(REPO_ROOT, "models/kws");

/** The model's word-piece table from its SentencePiece file (pieces with their merge scores). */
export function readPieces(bpeModel: Uint8Array): Map<string, number> {
  // A tiny protobuf reader: ModelProto field 1 = repeated SentencePiece { 1: piece (string), 2: score (float) }.
  const pieces = new Map<string, number>();
  const view = new DataView(bpeModel.buffer, bpeModel.byteOffset, bpeModel.byteLength);
  const varint = (b: Uint8Array, at: { i: number }) => {
    let v = 0;
    let shift = 0;
    for (;;) {
      const x = b[at.i++]!;
      v += (x & 0x7f) * 2 ** shift;
      if (x < 0x80) return v;
      shift += 7;
    }
  };
  const skip = (b: Uint8Array, at: { i: number }, wire: number) => {
    if (wire === 0) varint(b, at);
    else if (wire === 1) at.i += 8;
    else if (wire === 2) at.i += varint(b, at);
    else if (wire === 5) at.i += 4;
    else at.i = Infinity; // a field type this reader doesn't know: stop rather than loop
  };
  const at = { i: 0 };
  while (at.i < bpeModel.length) {
    const tag = varint(bpeModel, at);
    if (tag >> 3 === 1 && (tag & 7) === 2) {
      const len = varint(bpeModel, at);
      const end = at.i + len;
      let piece = "";
      let score = 0;
      while (at.i < end && at.i < bpeModel.length) {
        const t = varint(bpeModel, at);
        if (t >> 3 === 1 && (t & 7) === 2) {
          const n = varint(bpeModel, at);
          piece = new TextDecoder().decode(bpeModel.subarray(at.i, at.i + n));
          at.i += n;
        } else if (t >> 3 === 2 && (t & 7) === 5) {
          score = view.getFloat32(at.i, true);
          at.i += 4;
        } else skip(bpeModel, at, t & 7);
      }
      pieces.set(piece, score);
    } else skip(bpeModel, at, tag & 7);
  }
  return pieces;
}

/**
 * SentencePiece encoding (this model's "bpe.model" is a unigram model, as icefall makes them): the split of the word
 * whose pieces' scores (log probabilities) add up highest, found by Viterbi over the letters.
 */
export function bpeEncode(word: string, pieces: Map<string, number>): string[] | null {
  const w = `▁${word}`;
  const best: { score: number; from: number }[] = [{ score: 0, from: -1 }];
  for (let end = 1; end <= w.length; end++) {
    best[end] = { score: -Infinity, from: -1 };
    for (let start = Math.max(0, end - 16); start < end; start++) {
      const s = pieces.get(w.slice(start, end));
      if (s === undefined || best[start]!.score === -Infinity) continue;
      if (best[start]!.score + s > best[end]!.score) best[end] = { score: best[start]!.score + s, from: start };
    }
  }
  if (best[w.length]!.score === -Infinity) return null;
  const out: string[] = [];
  for (let end = w.length; end > 0; end = best[end]!.from) out.unshift(w.slice(best[end]!.from, end));
  return out;
}

/** Wake names → lines of the detector's keywords file. Names it can't spell are skipped. */
export function wakeKeywords(names: string[], pieces: Map<string, number>): string[] {
  const lines: string[] = [];
  for (const name of names) {
    const words = name.toUpperCase().replace(/[^A-Z' ]/g, " ").split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const encoded = words.map((w) => bpeEncode(w, pieces));
    // Boost and a slightly lower threshold than the default: missing "Ultron" is worse than one extra recognition.
    if (encoded.every(Boolean)) lines.push(`${encoded.flat().join(" ")} :2.0 #0.2 @${words.join("_")}`);
  }
  return lines;
}

/**
 * The wake-word detector: a tiny keyword-spotting model (in its own background process) that hears "Ultron" in a
 * phrase in a few tens of milliseconds. Hands-free used to run full speech recognition (~2 s of CPU) on every phrase,
 * including the TV; now only phrases with the name in them are recognised.
 */
export class WakeSpotter {
  readonly host = new ModelProcess("wake word");
  private pieces: Map<string, number> | null = null;
  /** Counts since start, for Settings → Performance: phrases checked, and how many needed full recognition. */
  readonly counts = { checked: 0, spotted: 0 };

  constructor(private dir = KWS_DIR) {}

  available(): boolean {
    return existsSync(join(this.dir, "tokens.txt")) && existsSync(join(this.dir, "bpe.model"));
  }

  keywords(names: string[]): string[] {
    this.pieces ??= readPieces(readFileSync(join(this.dir, "bpe.model")));
    return wakeKeywords(names, this.pieces);
  }

  /** Did this 16 kHz phrase contain a wake name? null if the detector can't run (then recognise everything, as before). */
  async spot(samples: Float32Array, names: string[]): Promise<{ hit: boolean; keyword: string } | null> {
    if (!this.available()) return null;
    const keywords = this.keywords(names);
    if (!keywords.length) return null;
    try {
      const r = await this.host.request<{ keyword: string }>({ kind: "kws.run", samples, dir: this.dir, keywords: keywords.join("\n") }, 15_000);
      this.counts.checked++;
      if (r.keyword) this.counts.spotted++;
      return { hit: Boolean(r.keyword), keyword: r.keyword };
    } catch {
      return null;
    }
  }
}
