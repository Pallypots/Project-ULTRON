import type { Capability } from "@ultron/schemas";
import type { ProviderResolution, ProviderSettings } from "./providers.ts";
import type { SttEngine } from "./stt/index.ts";

function voiceInput(stt: SttEngine | undefined): Capability {
  if (!stt) return { id: "voice_input", label: "Voice input (push-to-talk)", status: "not_configured", detail: "no speech engine" };
  const st = stt.status();
  const where = stt.id === "local" ? "recognized on this PC" : stt.id === "openai" ? "recognized by OpenAI" : "test engine";
  if (st.state === "not_configured" || st.state === "error") return { id: "voice_input", label: "Voice input (push-to-talk)", status: "not_configured", detail: st.detail };
  return { id: "voice_input", label: "Voice input (push-to-talk)", status: "enabled", detail: `${where}; microphone only on while the talk button is held${st.state === "ready" ? "" : `; ${st.detail}`}` };
}

/** The single source of truth for "what can you do right now?" - reported to the model and to the UI. */
export function currentCapabilities(settings: ProviderSettings, resolution: ProviderResolution, stt?: SttEngine): Capability[] {
  const model: Capability = resolution.ok
    ? {
        id: "model",
        label: "Language model",
        status: "enabled",
        detail:
          resolution.provider.id === "mock"
            ? "built-in offline mock (no real AI reasoning)"
            : resolution.provider.id === "ollama"
              ? `local model ${resolution.provider.model}, running on this computer (works offline)`
              : `cloud: ${resolution.provider.id} / ${resolution.provider.model} (messages are sent to that provider)`,
      }
    : { id: "model", label: "Language model", status: "not_configured", detail: resolution.reason };
  return [
    model,
    { id: "chat", label: "Text chat with streaming", status: "enabled", detail: "conversations saved on this computer" },
    { id: "memory", label: "Long-term memory", status: "enabled", detail: "only what the owner explicitly asks to remember; editable in the Memory Vault" },
    voiceInput(stt),
    { id: "voice_output", label: "Spoken replies", status: "not_implemented", detail: "planned next (UL-009)" },
    { id: "tools", label: "Actions/tools (reminders, files, apps)", status: "not_implemented", detail: "tool policy registry is planned; no actions can be taken yet" },
    { id: "brain_switch", label: "Switch brains by voice or text", status: "enabled", detail: 'e.g. "switch your brain to local" or "switch to Fable"' },
    { id: "integrations", label: "Connected accounts (email, calendar, GitHub, YouTube...)", status: "not_implemented", detail: "none connected" },
    { id: "screen", label: "Screen viewing", status: "disabled", detail: "not available" },
    { id: "remote", label: "Phone / remote access", status: "disabled", detail: "local computer only for now" },
  ];
}
