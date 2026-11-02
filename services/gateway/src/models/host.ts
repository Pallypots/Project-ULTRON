/**
 * Model host: runs one heavy on-device model (speech recognition or the voice) in its own process, so the service that
 * answers the app never freezes while a model loads or works, and a model crash (or running out of memory) can't take
 * ULTRON down. The parent sends requests over IPC; typed arrays travel with "advanced" serialization.
 */
import { mkdirSync } from "node:fs";

type Req =
  | { id: number; kind: "stt.load"; model: string; cacheDir: string }
  | { id: number; kind: "stt.run"; samples: Float32Array }
  | { id: number; kind: "tts.load"; dtype: string; model: string; cacheDir: string }
  | { id: number; kind: "tts.run"; text: string; voice: string; speed: number }
  | { id: number; kind: "kws.run"; samples: Float32Array; dir: string; keywords: string }
  | { id: number; kind: "test.wait"; ms: number }; // stands in for slow model work in tests

let sttModel = "";
let stt: ((a: Float32Array, o: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>) | null = null;
let tts: { generate(text: string, o: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }> } | null = null;

type Spotter = {
  createStream(): { acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void; inputFinished(): void };
  isReady(s: unknown): boolean;
  decode(s: unknown): void;
  getResult(s: unknown): { keyword: string };
  reset(s: unknown): void;
};
let kws: { spotter: Spotter; key: string } | null = null;

const progress = (target: "stt" | "tts") => {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.total || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    const all = [...files.values()];
    process.send?.({ kind: "progress", target, pct: Math.round((100 * all.reduce((a, f) => a + f.loaded, 0)) / all.reduce((a, f) => a + f.total, 0)) });
  };
};

async function handle(m: Req): Promise<unknown> {
  switch (m.kind) {
    case "stt.load": {
      if (stt) return { ok: true };
      mkdirSync(m.cacheDir, { recursive: true });
      const lib = await import("@huggingface/transformers");
      lib.env.cacheDir = m.cacheDir;
      sttModel = m.model;
      stt = (await lib.pipeline("automatic-speech-recognition", m.model, { cache_dir: m.cacheDir, progress_callback: progress("stt") })) as never;
      return { ok: true };
    }
    case "stt.run": {
      if (!stt) throw new Error("speech model not loaded");
      // Moonshine is built for short clips: a long recording is cut at pauses into ≤20 s pieces, each recognised in turn.
      if (/moonshine/i.test(sttModel)) {
        const { splitAtPauses } = await import("@ultron/audio");
        const texts: string[] = [];
        for (const piece of splitAtPauses(m.samples)) {
          const out = await stt(piece, {});
          texts.push((Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim());
        }
        return { text: texts.filter(Boolean).join(" ").trim() };
      }
      // Whisper: long-audio chunking only for long recordings; a short phrase is recognised in one pass.
      const out = await stt(m.samples, m.samples.length > 16000 * 28 ? { chunk_length_s: 30, stride_length_s: 5 } : {});
      return { text: (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim() };
    }
    case "tts.load": {
      if (tts) return { ok: true };
      mkdirSync(m.cacheDir, { recursive: true });
      const [{ KokoroTTS }, transformers] = await Promise.all([import("kokoro-js"), import("@huggingface/transformers")]);
      transformers.env.cacheDir = m.cacheDir;
      tts = (await KokoroTTS.from_pretrained(m.model, { dtype: m.dtype as "fp16", device: "cpu", progress_callback: progress("tts") as never })) as never;
      return { ok: true };
    }
    case "kws.run": {
      const key = `${m.dir}\n${m.keywords}`;
      if (kws?.key !== key) {
        const { createRequire } = await import("node:module");
        const sherpa = createRequire(import.meta.url)("sherpa-onnx-node") as { KeywordSpotter: new (c: unknown) => Spotter };
        const { writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const { tmpdir } = await import("node:os");
        const file = join(tmpdir(), `ultron-wake-${process.pid}.txt`);
        writeFileSync(file, m.keywords + "\n");
        kws = {
          key,
          spotter: new sherpa.KeywordSpotter({
            featConfig: { sampleRate: 16000, featureDim: 80 },
            modelConfig: {
              transducer: { encoder: join(m.dir, "encoder.int8.onnx"), decoder: join(m.dir, "decoder.int8.onnx"), joiner: join(m.dir, "joiner.int8.onnx") },
              tokens: join(m.dir, "tokens.txt"),
              numThreads: 1,
              provider: "cpu",
              debug: 0,
            },
            keywordsFile: file,
          }),
        };
      }
      const sp = kws.spotter;
      const stream = sp.createStream();
      stream.acceptWaveform({ sampleRate: 16000, samples: m.samples });
      stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(8000) }); // a little silence so the end is decoded
      stream.inputFinished();
      let keyword = "";
      while (sp.isReady(stream)) {
        sp.decode(stream);
        const r = sp.getResult(stream);
        if (r.keyword) {
          keyword ||= r.keyword;
          sp.reset(stream);
        }
      }
      return { keyword };
    }
    case "test.wait":
      await new Promise((r) => setTimeout(r, m.ms));
      return { waited: m.ms };
    case "tts.run": {
      if (!tts) throw new Error("voice not loaded");
      const out = await tts.generate(m.text, { voice: m.voice, speed: m.speed });
      return { audio: out.audio, rate: out.sampling_rate };
    }
  }
}

// One request at a time (predictable memory); the parent queues.
let chain: Promise<unknown> = Promise.resolve();
process.on("message", (m: Req) => {
  chain = chain.then(() =>
    handle(m).then(
      (result) => process.send?.({ id: m.id, result }),
      (err: Error) => process.send?.({ id: m.id, error: err?.message ?? String(err) }),
    ),
  );
});
process.on("disconnect", () => process.exit(0)); // parent gone: don't linger
