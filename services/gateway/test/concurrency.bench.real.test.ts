// Is there a measurable benefit from parallelism (more processes/cores at once) or concurrency (overlapping work)?
// Measured with the REAL local models on the CI machines. Results are reported as CI notices; the assertions only
// check that each measurement ran, plus the one claim the design depends on (models outside the service keep it
// responsive). Only runs with ULTRON_TEST_TTS=1.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cpus } from "node:os";
import { describe, expect, it } from "vitest";
import { resample } from "@ultron/audio";
import { ModelProcess } from "../src/models/process.ts";
import { KOKORO_MODEL } from "../src/tts/kokoro.ts";
import { DEFAULT_LOCAL_MODEL } from "../src/stt/local-whisper.ts";
import { ciNote } from "./helpers.ts";

const enabled = process.env.ULTRON_TEST_TTS === "1";
const dir = process.env.ULTRON_TEST_MODEL_DIR ?? join(tmpdir(), "ultron-test-models");
const SENTENCES = [
  "Good evening. All systems are running locally.",
  "Your calendar is clear until three o'clock this afternoon.",
  "There is a seventy percent chance of rain around four.",
  "I have also finished summarising the report you asked for.",
];

/** Worst and 95th-percentile delay of a 10 ms timer while `work` runs: how "frozen" the service would feel. */
async function lagDuring(work: () => Promise<unknown>) {
  const lags: number[] = [];
  let last = performance.now();
  const iv = setInterval(() => {
    const now = performance.now();
    lags.push(now - last - 10);
    last = now;
  }, 10);
  const t0 = performance.now();
  await work();
  const ms = performance.now() - t0;
  clearInterval(iv);
  lags.sort((a, b) => a - b);
  return { ms: Math.round(ms), worstLag: Math.round(lags.at(-1) ?? 0), p95Lag: Math.round(lags[Math.floor(lags.length * 0.95)] ?? 0) };
}

describe.skipIf(!enabled)("parallelism and concurrency: measured", () => {
  it("measures in-process vs separate-process models, sentence pipelining, and 1 vs 2 voice processes", async () => {
    const results: string[] = [`${cpus().length} CPU threads`];
    const ttsLoad = { kind: "tts.load", dtype: "fp16", model: KOKORO_MODEL, cacheDir: dir };
    const synth = (p: ModelProcess, text: string) => p.request<{ audio: Float32Array; rate: number }>({ kind: "tts.run", text, voice: "bm_george", speed: 1 }, 300_000);

    // 1. Responsiveness: the voice running INSIDE this process vs in its own process.
    const { KokoroTTS } = await import("kokoro-js");
    const transformers = await import("@huggingface/transformers");
    transformers.env.cacheDir = dir;
    const inProc = (await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "fp16", device: "cpu" })) as unknown as { generate(t: string, o: object): Promise<unknown> };
    await inProc.generate("Warm up.", { voice: "bm_george" });
    const inside = await lagDuring(async () => {
      for (const s of SENTENCES) await inProc.generate(s, { voice: "bm_george" });
    });
    const host = new ModelProcess("voice");
    await host.request(ttsLoad, 1_800_000);
    await synth(host, "Warm up.");
    const outside = await lagDuring(async () => {
      for (const s of SENTENCES) await synth(host, s);
    });
    results.push(`1) responsiveness while speaking 4 sentences: in-process worst freeze ${inside.worstLag} ms (p95 ${inside.p95Lag}) vs separate process worst ${outside.worstLag} ms (p95 ${outside.p95Lag}); time ${inside.ms} vs ${outside.ms} ms`);

    // 2. Concurrency (pipelining): time until the FIRST audio is ready, whole paragraph vs sentence by sentence.
    const whole = performance.now();
    await synth(host, SENTENCES.join(" "));
    const wholeMs = Math.round(performance.now() - whole);
    const first = performance.now();
    await synth(host, SENTENCES[0]!);
    const firstMs = Math.round(performance.now() - first);
    results.push(`2) time to first audio: whole reply ${wholeMs} ms vs first sentence ${firstMs} ms (pipelining saves ${wholeMs - firstMs} ms)`);

    // 3. Parallelism: 4 sentences on 1 process (sequential) vs 2 processes at once.
    const seq = performance.now();
    for (const s of SENTENCES) await synth(host, s);
    const seqMs = Math.round(performance.now() - seq);
    const host2 = new ModelProcess("voice 2");
    await host2.request(ttsLoad, 1_800_000);
    await synth(host2, "Warm up.");
    const par = performance.now();
    await Promise.all([
      (async () => { await synth(host, SENTENCES[0]!); await synth(host, SENTENCES[2]!); })(),
      (async () => { await synth(host2, SENTENCES[1]!); await synth(host2, SENTENCES[3]!); })(),
    ]);
    const parMs = Math.round(performance.now() - par);
    results.push(`3) 4 sentences: 1 process ${seqMs} ms vs 2 processes in parallel ${parMs} ms (${(seqMs / parMs).toFixed(2)}x)`);
    host2.stop();

    // 4. Listening while talking: speech recognition alone vs while the voice is busy (separate processes run in parallel).
    const stt = new ModelProcess("speech recognition");
    await stt.request({ kind: "stt.load", model: DEFAULT_LOCAL_MODEL, cacheDir: dir }, 1_800_000);
    const clip = await synth(host, "Ultron, what time is it?");
    const samples = resample(clip.audio, clip.rate);
    await stt.request({ kind: "stt.run", samples }, 300_000);
    const alone = performance.now();
    await stt.request({ kind: "stt.run", samples }, 300_000);
    const aloneMs = Math.round(performance.now() - alone);
    const busy = performance.now();
    const speaking = synth(host, SENTENCES.join(" "));
    await stt.request({ kind: "stt.run", samples }, 300_000);
    const busyMs = Math.round(performance.now() - busy);
    await speaking;
    results.push(`4) hearing a phrase: ${aloneMs} ms alone vs ${busyMs} ms while the voice is also working`);
    stt.stop();
    host.stop();

    ciNote("Parallelism / concurrency benchmark", results.join(" || "));
    console.log(results.join("\n"));
    // The design claim: models outside the service keep it responsive (much smaller worst-case freeze).
    expect(outside.worstLag).toBeLessThan(Math.max(250, inside.worstLag));
  }, 3_600_000);
});
