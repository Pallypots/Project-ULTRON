import {
  AnthropicProvider,
  DEFAULT_ANTHROPIC_MODEL,
  MockProvider,
  OllamaProvider,
  OpenAICompatibleProvider,
  type ModelProvider,
} from "@ultron/agent-core";
import type { PreferenceStore } from "@ultron/memory";
import type { ProviderId } from "@ultron/schemas";
import type { SecretStore } from "./secrets.ts";

export interface ProviderSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
}

export const SECRET_FOR: Record<ProviderId, string | null> = {
  mock: null,
  ollama: null,
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function readProviderSettings(prefs: PreferenceStore): ProviderSettings {
  const envProvider = process.env.ULTRON_PROVIDER as ProviderId | undefined;
  return prefs.get<ProviderSettings>("provider", {
    provider: envProvider ?? "mock",
    model: process.env.ULTRON_MODEL ?? "",
    baseUrl: process.env.ULTRON_BASE_URL ?? "",
  });
}

/** Saves the active provider and remembers its model so voice switching can return to it. */
export function saveProviderSettings(prefs: PreferenceStore, next: ProviderSettings): void {
  prefs.set("provider", next);
  const last = prefs.get<Record<string, { model: string; baseUrl: string }>>("provider_models", {});
  if (next.model || next.baseUrl) last[next.provider] = { model: next.model, baseUrl: next.baseUrl };
  prefs.set("provider_models", last);
}

export const isLocalProvider = (p: ProviderId) => p === "ollama" || p === "mock";

export type ProviderResolution = { ok: true; provider: ModelProvider } | { ok: false; reason: string };

export function resolveProvider(s: ProviderSettings, secrets: SecretStore, mockDelayMs: number): ProviderResolution {
  try {
    switch (s.provider) {
      case "mock":
        return { ok: true, provider: new MockProvider(mockDelayMs) };
      case "ollama":
        if (!s.model) return { ok: false, reason: "Local AI is selected but no local model is chosen. Pick or download one in Settings → Language model." };
        return { ok: true, provider: new OllamaProvider({ model: s.model, baseUrl: s.baseUrl }) };
      case "anthropic": {
        const apiKey = secrets.get("ANTHROPIC_API_KEY");
        if (!apiKey) return { ok: false, reason: "Claude is selected but no Anthropic API key is saved. Add one in Settings." };
        return { ok: true, provider: new AnthropicProvider({ apiKey, model: s.model || DEFAULT_ANTHROPIC_MODEL, baseUrl: s.baseUrl }) };
      }
      case "openai": {
        const apiKey = secrets.get("OPENAI_API_KEY");
        if (!apiKey && !s.baseUrl) return { ok: false, reason: "OpenAI is selected but no API key is saved. Add one in Settings (local servers only need a base URL)." };
        return { ok: true, provider: new OpenAICompatibleProvider({ apiKey, model: s.model, baseUrl: s.baseUrl }) };
      }
    }
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
