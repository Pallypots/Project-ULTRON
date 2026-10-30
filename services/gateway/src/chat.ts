import { buildSystemPrompt, detectIntent, ProviderError, type ChatTurn, type Persona } from "@ultron/agent-core";
import type { Stores } from "@ultron/memory";
import type { ChatEvent, Memory, Message } from "@ultron/schemas";
import { currentCapabilities } from "./capabilities.ts";
import { readProviderSettings, resolveProvider, saveProviderSettings } from "./providers.ts";
import { resolveBrain } from "./brains.ts";
import type { OllamaManager } from "./local-ai/ollama.ts";
import type { SecretStore } from "./secrets.ts";
import type { SttEngine } from "./stt/index.ts";

const HISTORY_TURNS = 30;
const HISTORY_CHAR_BUDGET = 60_000;

export interface ChatDeps {
  stores: Stores;
  secrets: SecretStore;
  persona: () => Persona;
  mockDelayMs: number;
  stt?: () => SttEngine;
  ttsEngine?: () => string;
  ollama?: OllamaManager;
}

/** Tracks in-flight replies so the owner's stop button (and disconnects) can cancel them. */
export class ActiveStreams {
  private active = new Map<string, AbortController>();
  start(conversationId: string): AbortController | null {
    if (this.active.has(conversationId)) return null;
    const c = new AbortController();
    this.active.set(conversationId, c);
    return c;
  }
  finish(conversationId: string) {
    this.active.delete(conversationId);
  }
  stopAll(): number {
    const n = this.active.size;
    for (const c of this.active.values()) c.abort();
    this.active.clear();
    return n;
  }
  get size() {
    return this.active.size;
  }
}

function historyFor(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let chars = 0;
  for (const m of [...messages].reverse()) {
    if (m.role === "system" || !m.content.trim() || m.status === "error") continue;
    chars += m.content.length;
    if (turns.length >= HISTORY_TURNS || chars > HISTORY_CHAR_BUDGET) break;
    turns.unshift({ role: m.role, content: m.content });
  }
  // Providers require the conversation to start with a user turn.
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

const brief = (m: Memory) => ({ id: m.id, content: m.content, kind: m.kind, createdAt: m.createdAt });

export async function handleUserMessage(
  deps: ChatDeps,
  conversationId: string,
  content: string,
  opts: { deviceId?: string; inputMode?: Message["inputMode"]; signal: AbortSignal; emit: (e: ChatEvent) => void },
): Promise<void> {
  const { stores, emit } = { ...deps, emit: opts.emit };
  const settings = readProviderSettings(stores.preferences);
  const resolution = resolveProvider(settings, deps.secrets, deps.mockDelayMs);
  const providerId = resolution.ok ? resolution.provider.id : settings.provider;
  const modelId = resolution.ok ? resolution.provider.model : settings.model;

  const conv = stores.conversations.get(conversationId)!;
  if (conv.title === "New conversation") stores.conversations.rename(conversationId, content.length > 60 ? `${content.slice(0, 57).trimEnd()}…` : content);

  const userMessage = stores.conversations.addMessage({ conversationId, role: "user", content, sourceDeviceId: opts.deviceId ?? null, inputMode: opts.inputMode ?? "text" });
  const assistant = stores.conversations.addMessage({
    conversationId,
    role: "assistant",
    content: "",
    status: "streaming",
    provider: providerId,
    model: modelId,
  });
  emit({ type: "start", userMessage, assistantMessageId: assistant.id, provider: providerId, model: modelId });

  const finish = (text: string, status: Message["status"], memoryIds: string[] = []) => {
    const done = stores.conversations.updateMessage(assistant.id, { content: text, status, memoryIds })!;
    emit({ type: "done", message: done });
  };

  // Explicit memory commands are handled deterministically, so saving never depends on the model's mood.
  const intent = detectIntent(content);
  if (intent.type === "remember_blocked") {
    const reason = `I won't store ${intent.reason} in memory, even on request. Keep those in a password manager or a secure vault.`;
    stores.audit.record("memory.blocked", "owner", null, { reason: intent.reason, conversationId });
    emit({ type: "memory_blocked", reason });
    emit({ type: "delta", text: reason });
    return finish(reason, "complete");
  }
  if (intent.type === "remember") {
    const memory = stores.memories.create({
      content: intent.content,
      kind: intent.kind,
      sensitivity: intent.sensitivity,
      source: "chat",
      sourceConversationId: conversationId,
      sourceMessageId: userMessage.id,
    });
    stores.audit.record("memory.created", "owner", memory.id, { via: "chat", kind: memory.kind });
    emit({ type: "memory_saved", memory });
    const text =
      `Got it. I'll remember: "${memory.content}" [memory:${memory.id.slice(0, 8)}]` +
      (memory.sensitivity === "sensitive" ? "\nThat looks personal, so I've marked it sensitive. You can edit or delete it in the Memory Vault anytime." : "\nYou can edit or delete it in the Memory Vault anytime.");
    emit({ type: "delta", text });
    return finish(text, "complete", [memory.id]);
  }
  if (intent.type === "forget") {
    const matches = stores.memories.search(intent.query, 3);
    let text: string;
    if (!matches.length) {
      text = `I couldn't find a saved memory matching "${intent.query}". Nothing was deleted. The Memory Vault lists everything I have.`;
    } else {
      const target = matches[0]!;
      stores.memories.delete(target.id);
      stores.audit.record("memory.deleted", "owner", target.id, { via: "chat" });
      emit({ type: "memory_forgotten", memory: { id: target.id, content: target.content } });
      text = `Forgotten. I deleted: "${target.content}". It won't be used again.` + (matches.length > 1 ? " If you meant a different one, check the Memory Vault." : "");
    }
    emit({ type: "delta", text });
    return finish(text, "complete");
  }

  if (intent.type === "switch_brain") {
    let installedLocal: string[] | null = null;
    if (deps.ollama && (await deps.ollama.version())) installedLocal = (await deps.ollama.models().catch(() => [])).map((m) => m.name);
    const target = resolveBrain(intent.target, {
      current: settings,
      lastModels: stores.preferences.get("provider_models", {}),
      installedLocal,
      keys: { anthropic: deps.secrets.has("ANTHROPIC_API_KEY"), openai: deps.secrets.has("OPENAI_API_KEY") },
    });
    let text: string;
    if (target.ok) {
      // Use the Ollama server ULTRON is actually talking to.
      if (target.settings.provider === "ollama" && deps.ollama) target.settings.baseUrl = deps.ollama.url;
      saveProviderSettings(stores.preferences, target.settings);
      stores.audit.record("settings.brain_switched", "owner", target.settings.provider, { model: target.settings.model, via: "chat" });
      emit({ type: "brain_changed", provider: target.settings.provider, model: target.settings.model, where: target.where });
      text =
        target.where === "local"
          ? `Brain switched: ${target.label}, running entirely on this computer. Nothing we say leaves the machine now.`
          : target.where === "cloud"
            ? `Brain switched: ${target.label}. Heads-up: from now on your messages and relevant memories are sent to ${target.settings.provider === "anthropic" ? "Anthropic" : "OpenAI"}. Say "go local" to come back.`
            : "Brain switched to the built-in test brain. Replies will be canned until you switch back.";
    } else text = target.message;
    emit({ type: "delta", text });
    return finish(text, "complete");
  }

  if (!resolution.ok) {
    emit({ type: "error", code: "provider_not_configured", message: resolution.reason });
    return finish(resolution.reason, "error");
  }

  const memories = stores.memories.retrieveForPrompt(content);
  if (memories.length) emit({ type: "memories", memories: memories.map(brief) });
  const capabilities = currentCapabilities(settings, resolution, deps.stt?.(), deps.ttsEngine?.());
  const system = buildSystemPrompt(deps.persona(), {
    capabilities,
    memories,
    nowIso: new Date().toISOString(),
  });
  const history = historyFor(stores.conversations.messages(conversationId).filter((m) => m.id !== assistant.id));

  let text = "";
  let lastFlush = Date.now();
  try {
    for await (const chunk of resolution.provider.stream({ system, messages: history, memories, capabilities, signal: opts.signal })) {
      if (opts.signal.aborted) break;
      text += chunk;
      emit({ type: "delta", text: chunk });
      // Persist partial text periodically so a crash keeps what was already said.
      if (Date.now() - lastFlush > 1000) {
        stores.conversations.updateMessage(assistant.id, { content: text });
        lastFlush = Date.now();
      }
    }
    const used = memories.filter((m) => text.includes(m.id.slice(0, 8))).map((m) => m.id);
    finish(text, opts.signal.aborted ? "cancelled" : "complete", used.length ? used : memories.map((m) => m.id));
  } catch (err) {
    if (opts.signal.aborted) return finish(text, "cancelled");
    const message = err instanceof ProviderError ? err.message : `Something went wrong talking to the model: ${(err as Error).message}`;
    const code = err instanceof ProviderError ? err.code : "unknown";
    stores.audit.record("model.error", "system", assistant.id, { code, provider: providerId });
    emit({ type: "error", code, message });
    finish(text ? `${text}\n\n[Stopped: ${message}]` : message, "error");
  }
}
