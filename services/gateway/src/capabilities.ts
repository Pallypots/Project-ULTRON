import type { Capability } from "@ultron/schemas";
import type { ProviderResolution, ProviderSettings } from "./providers.ts";

/** The single source of truth for "what can you do right now?" - reported to the model and to the UI. */
export function currentCapabilities(settings: ProviderSettings, resolution: ProviderResolution): Capability[] {
  const model: Capability = resolution.ok
    ? {
        id: "model",
        label: "Language model",
        status: "enabled",
        detail: resolution.provider.id === "mock" ? "built-in offline mock (no real AI reasoning)" : `${resolution.provider.id} / ${resolution.provider.model}`,
      }
    : { id: "model", label: "Language model", status: "not_configured", detail: resolution.reason };
  return [
    model,
    { id: "chat", label: "Text chat with streaming", status: "enabled", detail: "conversations saved on this computer" },
    { id: "memory", label: "Long-term memory", status: "enabled", detail: "only what the owner explicitly asks to remember; editable in the Memory Vault" },
    { id: "voice", label: "Voice (push-to-talk, spoken replies)", status: "not_implemented", detail: "planned for the next development cycle" },
    { id: "tools", label: "Actions/tools (reminders, files, apps)", status: "not_implemented", detail: "tool policy registry is planned; no actions can be taken yet" },
    { id: "integrations", label: "Connected accounts (email, calendar, GitHub, YouTube...)", status: "not_implemented", detail: "none connected" },
    { id: "screen", label: "Screen viewing", status: "disabled", detail: "not available" },
    { id: "remote", label: "Phone / remote access", status: "disabled", detail: "local computer only for now" },
  ];
}
