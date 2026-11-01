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
  | { id: number; kind: "test.wait"; ms: number }; // stands in for slow model work in tests

let stt: ((a: Float32Array, o: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>) | null = null;
let tts: { generate(text: string, o: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }> } | null = null;

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
      stt = (await lib.pipeline("automatic-speech-recognition", m.model, { cache_dir: m.cacheDir, progress_callback: progress("stt") })) as never;
      return { ok: true };
    }
    case "stt.run": {
      if (!stt) throw new Error("speech model not loaded");
      // Long-audio chunking only for long recordings; a short phrase is recognised in one pass.
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
