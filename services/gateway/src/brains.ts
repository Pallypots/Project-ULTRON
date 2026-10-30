import { DEFAULT_ANTHROPIC_MODEL } from "@ultron/agent-core";
import type { ProviderSettings } from "./providers.ts";

export type BrainResolution =
  | { ok: true; settings: ProviderSettings; label: string; where: "local" | "cloud" | "test" }
  | { ok: false; message: string };

export interface BrainContext {
  current: ProviderSettings;
  /** Last model used per provider, so "switch to openai" can return to it. */
  lastModels: Partial<Record<ProviderSettings["provider"], { model: string; baseUrl: string }>>;
  installedLocal: string[] | null; // null = Ollama not running
  keys: { anthropic: boolean; openai: boolean };
}

const CLAUDE: [RegExp, string, string][] = [
  [/fable/, "claude-fable-5-1", "Claude Fable 5.1"],
  [/sonnet/, "claude-sonnet-5-5", "Claude Sonnet 5.5"],
  [/haiku/, "claude-haiku-5-5", "Claude Haiku 5.5"],
  [/opus|claude|anthropic/, DEFAULT_ANTHROPIC_MODEL, "Claude Opus 5.5"],
];

const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "");

/** Maps a spoken/typed brain name to concrete provider settings, or explains why it can't. */
export function resolveBrain(target: string, ctx: BrainContext): BrainResolution {
  const t = target.toLowerCase().trim();
  const local = ctx.installedLocal;

  if (/^(mock|test)\b/.test(t)) return { ok: true, settings: { provider: "mock", model: "", baseUrl: "" }, label: "the built-in test brain", where: "test" };

  const wantsLocal = /\b(local|offline|ollama|on[- ]device)\b/.test(t);
  const localMatch = local?.find((m) => norm(m).includes(norm(t)) || norm(m.split(":")[0]!) === norm(t.split(":")[0]!));
  if (wantsLocal || localMatch) {
    if (local === null) return { ok: false, message: "Local AI (Ollama) isn't running, so I can't switch to a local brain. Start the Ollama app, or set it up in Settings → Language model." };
    if (!local.length) return { ok: false, message: "No local model is downloaded yet. Open Settings → Language model → Local AI and download the recommended one." };
    const model = localMatch ?? (ctx.current.provider === "ollama" && local.includes(ctx.current.model) ? ctx.current.model : ctx.lastModels.ollama?.model && local.includes(ctx.lastModels.ollama.model) ? ctx.lastModels.ollama.model : local[0]!);
    return { ok: true, settings: { provider: "ollama", model, baseUrl: ctx.lastModels.ollama?.baseUrl ?? "" }, label: `local ${model}`, where: "local" };
  }

  for (const [re, model, label] of CLAUDE) {
    if (re.test(t)) {
      if (!ctx.keys.anthropic) return { ok: false, message: `${label} needs an Anthropic API key, and none is saved. Add one in Settings → Language model if you want cloud brains.` };
      return { ok: true, settings: { provider: "anthropic", model, baseUrl: "" }, label, where: "cloud" };
    }
  }

  if (/\b(gpt|openai|chatgpt)\b/.test(t)) {
    const last = ctx.lastModels.openai;
    if (!ctx.keys.openai && !last?.baseUrl) return { ok: false, message: "OpenAI isn't set up (no API key saved). Add one in Settings → Language model." };
    if (!last?.model) return { ok: false, message: "Pick an OpenAI model in Settings → Language model first; after that you can switch by voice." };
    return { ok: true, settings: { provider: "openai", model: last.model, baseUrl: last.baseUrl }, label: `OpenAI ${last.model}`, where: "cloud" };
  }

  if (local === null) return { ok: false, message: `I don't know a brain called "${target}". Try "local", "Claude", "Fable", or the name of a downloaded local model.` };
  return {
    ok: false,
    message: `"${target}" isn't one of my brains. Local models I have: ${local.length ? local.join(", ") : "none yet"}. Cloud options: Claude, Fable, Sonnet, Haiku (with an API key).`,
  };
}
