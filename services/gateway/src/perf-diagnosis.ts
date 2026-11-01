import type { Hardware } from "./local-ai/hardware.ts";
import type { PerfLog } from "./perf.ts";

export interface OllamaPs {
  name: string;
  size: number;
  sizeVram: number;
}

/** Which models Ollama has loaded right now, and how much of each sits in graphics memory. */
export async function ollamaPs(baseUrl: string): Promise<OllamaPs[] | null> {
  try {
    const res = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name: string; size?: number; size_vram?: number }[] };
    return (data.models ?? []).map((m) => ({ name: m.name, size: m.size ?? 0, sizeVram: m.size_vram ?? 0 }));
  } catch {
    return null;
  }
}

const s = (ms: number | null) => (ms === null ? "?" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

/**
 * Plain-English findings from the measurements: what's slow and what to do. Each line names the evidence, so the owner
 * (and whoever fixes it) can see why.
 */
export function diagnose(summary: ReturnType<PerfLog["summary"]>, hw: Hardware | null, ps: OllamaPs[] | null, model: string): string[] {
  const out: string[] = [];
  const loaded = ps?.find((m) => m.name === model || m.name.startsWith(`${model}:`) || model.startsWith(m.name));
  if (loaded) {
    const gpuShare = loaded.size ? loaded.sizeVram / loaded.size : 0;
    if (gpuShare >= 0.95) out.push(`The brain (${model}) is running on the graphics card. Good.`);
    else if (gpuShare > 0) out.push(`Only ${Math.round(gpuShare * 100)}% of the brain fits on the graphics card; the rest runs on the processor, which is much slower. A smaller model would fit entirely.`);
    else if (hw?.usableGpu) out.push(`You have a ${hw.usableGpu.name}, but the brain is running on the processor. Update Ollama and its graphics drivers so it can use the card; that is usually several times faster.`);
    else if (hw?.gpus.some((g) => g.vendor === "intel" || g.vendor === "amd")) out.push(`The brain runs on the processor. Your ${hw.gpus.find((g) => g.vendor === "intel" || g.vendor === "amd")!.name} might be usable through Ollama's Vulkan support (Ollama 0.12.6 or newer); see Ollama's GPU documentation.`);
    else out.push("The brain runs on the processor (no usable graphics card found). Replies will be slower; small models and short prompts matter most.");
  } else if (ps) out.push("The brain isn't loaded right now, so the next reply will wait for it to load.");
  const load = summary.modelLoad.p90;
  if (load !== null && load > 1500) out.push(`The brain is being reloaded between replies (up to ${s(load)}). It should stay loaded.`);
  const prompt = summary.promptReading.p50;
  if (prompt !== null && prompt > 2000) out.push(`Reading the instructions and conversation takes ${s(prompt)} per reply (${summary.promptTokens.p50 ?? "?"} tokens). This is the biggest delay when it's high; it should mostly be reused from the previous turn.`);
  const stt = summary.speechRecognition.p50;
  if (stt !== null && stt > 1500) out.push(`Recognising your speech takes ${s(stt)}.`);
  const tps = summary.outputTokensPerSec.p50;
  if (tps !== null && tps < 8) out.push(`The brain writes about ${tps} words-pieces per second, which is slow for speech. A smaller model, or the graphics card, would help.`);
  if (!out.length) out.push("Not enough measurements yet: have a few conversations, then check again.");
  return out;
}
