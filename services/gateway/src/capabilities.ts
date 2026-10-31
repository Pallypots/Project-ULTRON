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
export function currentCapabilities(settings: ProviderSettings, resolution: ProviderResolution, stt?: SttEngine, ttsEngine?: string): Capability[] {
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
    { id: "memory", label: "Long-term memory", status: "enabled", detail: "only what the owner asks to remember or approves when ULTRON offers; recalled by keywords and by meaning (local model); editable in the Memory Vault" },
    voiceInput(stt),
    {
      id: "voice_output",
      label: "Spoken replies",
      status: "enabled",
      detail:
        ttsEngine === "browser"
          ? "using this computer's built-in voices; interrupt by talking or pressing Stop"
          : "natural voice generated on this computer (Kokoro); interrupt by talking or pressing Stop",
    },
    {
      id: "tools",
      label: "Actions",
      status: "enabled",
      detail: "check the time; set, list and cancel reminders and timers; keep a to-do list (add, list, tick off); search and read files in folders you approved; open a website, a file or an installed app (asks for approval first); media keys and volume (Windows); PC status (memory, disk, battery). App control not yet available",
    },
    {
      id: "knowledge",
      label: "Knowledge & everyday help",
      status: "enabled",
      detail: "exact calculator; Wikipedia look-ups; weather and 3-day forecast (Open-Meteo); read a web page the owner links (other pages need approval); search past conversations; review everything it remembers about the owner. No general web search yet",
    },
    { id: "brain_switch", label: "Switch brains by voice or text", status: "enabled", detail: 'e.g. "switch your brain to local" or "switch to Fable"' },
    { id: "integrations", label: "Connected accounts", status: "enabled", detail: "GitHub (read-only, if connected in Connections); calendar (read-only, via its private iCal link, if connected); YouTube, Reddit, Discord and email not available yet. Use connected_updates for real data; never guess" },
    { id: "screen", label: "Screen viewing", status: "disabled", detail: "not available" },
    { id: "remote", label: "Phone / remote access", status: "disabled", detail: "local computer only for now" },
  ];
}
