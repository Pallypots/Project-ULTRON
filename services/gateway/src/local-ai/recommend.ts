import type { Hardware } from "./hardware.ts";

export interface ModelSuggestion {
  model: string;
  label: string;
  approxDownloadGb: number;
  why: string;
}

const GB = 1024 ** 3;

// Only tags confirmed in Ollama's own documentation (checked 2026-10-30). Owners can type any other library tag.
export const CATALOG: Record<string, ModelSuggestion> = {
  "gemma4:e2b": { model: "gemma4:e2b", label: "Gemma 4 E2B (small, fast)", approxDownloadGb: 2, why: "Runs on almost any PC, even without a graphics card." },
  "qwen3:4b": { model: "qwen3:4b", label: "Qwen 3 4B", approxDownloadGb: 2.6, why: "Good quality for an entry-level graphics card." },
  "qwen3:8b": { model: "qwen3:8b", label: "Qwen 3 8B", approxDownloadGb: 5.2, why: "Strong all-rounder for 8 GB+ graphics cards." },
  "gpt-oss:20b": { model: "gpt-oss:20b", label: "gpt-oss 20B", approxDownloadGb: 14, why: "Noticeably smarter; needs a 16 GB+ graphics card for good speed." },
  "gemma4:31b": { model: "gemma4:31b", label: "Gemma 4 31B", approxDownloadGb: 20, why: "Best quality here; needs a 24 GB+ graphics card." },
};

export interface Recommendation {
  primary: ModelSuggestion;
  alternatives: ModelSuggestion[];
  summary: string;
}

/** Picks the most capable model that will run at a comfortable speed on this machine. */
export function recommendModel(hw: Pick<Hardware, "ramBytes" | "usableGpu">): Recommendation {
  const vram = hw.usableGpu?.vramBytes ?? 0;
  const ram = hw.ramBytes;
  const c = CATALOG;
  let primary: ModelSuggestion;
  let summary: string;
  if (vram >= 23 * GB) {
    primary = c["gemma4:31b"]!;
    summary = `${hw.usableGpu!.name} with ${Math.round(vram / GB)} GB can run large models.`;
  } else if (vram >= 15 * GB) {
    primary = c["gpt-oss:20b"]!;
    summary = `${hw.usableGpu!.name} with ${Math.round(vram / GB)} GB can run mid-size models.`;
  } else if (vram >= 7.5 * GB) {
    primary = c["qwen3:8b"]!;
    summary = `${hw.usableGpu!.name} with ${Math.round(vram / GB)} GB suits 8-billion-parameter models.`;
  } else if (vram >= 3.5 * GB) {
    primary = c["qwen3:4b"]!;
    summary = `${hw.usableGpu!.name} with ${Math.round(vram / GB)} GB suits small models.`;
  } else {
    primary = c["gemma4:e2b"]!;
    summary =
      ram >= 15 * GB
        ? `No supported graphics card found, so the AI runs on the processor. ${Math.round(ram / GB)} GB RAM is enough for small models (slower than a GPU).`
        : `No supported graphics card found and ${Math.round(ram / GB)} GB RAM, so a small model is the safe choice.`;
  }
  const alternatives = Object.values(c).filter((m) => m.model !== primary.model && m.approxDownloadGb <= Math.max(primary.approxDownloadGb * 1.5, 3));
  return { primary, alternatives, summary };
}
