import { buildSystemPrompt, detectIntent, detectQuickCommand, detectTimeIntent, ProviderError, type ChatTurn, type Persona, type ProviderEvent, type ToolCall } from "@ultron/agent-core";
import type { ToolEvent } from "@ultron/schemas";
import { MAX_CALLS_PER_TURN, toEvent, type ActionRunner } from "./actions/runner.ts";
import { claimsUnbackedAction, focusTools, HONESTY_NOTE } from "./actions/focus.ts";
import { TOOLS } from "./actions/tools.ts";
import type { EmbeddingService } from "./embeddings/index.ts";
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
  actions?: ActionRunner;
  embeddings?: EmbeddingService;
}

const MAX_TOOL_ROUNDS = 4;
const specsFor = (tools: typeof TOOLS) => tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

async function* textOnly(it: AsyncIterable<string>): AsyncIterable<ProviderEvent> {
  for await (const text of it) yield { type: "text", text };
}

/** Finds the upcoming reminder the owner most likely means. */
function matchReminder<T extends { text: string }>(items: T[], query: string): T | null {
  if (!query) return items.length === 1 ? items[0]! : null;
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  let best: T | null = null;
  let bestScore = 0;
  for (const r of items) {
    const t = r.text.toLowerCase();
    const score = words.filter((w) => t.includes(w)).length;
    if (score > bestScore) [best, bestScore] = [r, score];
  }
  return best;
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
  const turns: Extract<ChatTurn, { role: "user" | "assistant" }>[] = [];
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
  // Title from the first message with substance ("hey ultron" says nothing about the conversation, and titles feed catch-up).
  if (conv.title === "New conversation" && !isSmallTalk(content)) stores.conversations.rename(conversationId, content.length > 60 ? `${content.slice(0, 57).trimEnd()}…` : content);

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

  let toolEvents: ToolEvent[] = [];
  // The owner may approve or deny an action while this reply is still streaming; never write back a stale status.
  const latest = () => (toolEvents = toolEvents.map((t) => {
    const e = stores.actions.get(t.executionId);
    return e ? toEvent(e) : t;
  }));
  const finish = (text: string, status: Message["status"], memoryIds: string[] = []) => {
    const done = stores.conversations.updateMessage(assistant.id, { content: text, status, memoryIds, toolEvents: latest() })!;
    emit({ type: "done", message: done });
  };
  const recordTool = (e: ToolEvent) => {
    toolEvents.push(e);
    emit({ type: "tool", event: e });
    stores.conversations.updateMessage(assistant.id, { toolEvents: latest() });
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
    deps.embeddings?.backfill().catch(() => {});
    emit({ type: "memory_saved", memory });
    const text =
      `Got it. I'll remember: "${memory.content}" [memory:${memory.id.slice(0, 8)}]` +
      (memory.sensitivity === "sensitive" ? "\nThat looks personal, so I've marked it sensitive. You can edit or delete it in the Memory Vault anytime." : "\nYou can edit or delete it in the Memory Vault anytime.");
    emit({ type: "delta", text });
    return finish(text, "complete", [memory.id]);
  }
  if (intent.type === "forget") {
    const matches = stores.memories.search(intent.query, 5);
    const words = (intent.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !["the", "that", "about", "and", "with", "for", "you", "my"].includes(w));
    // Only delete on a clear match: every meaningful word appears in it, or it's the only candidate.
    const strong = matches.filter((m) => words.every((w) => m.content.toLowerCase().includes(w.slice(0, Math.max(4, w.length - 2)))));
    let text: string;
    if (opts.inputMode === "voice") {
      text = `For safety I don't delete memories from voice alone (background audio could say it). Type "forget ${intent.query}", or use the Memory Vault.`;
    } else if (!matches.length) {
      text = `I couldn't find a saved memory matching "${intent.query}". Nothing was deleted. The Memory Vault lists everything I have.`;
    } else if (strong.length !== 1 && !(matches.length === 1 && strong.length === 1)) {
      const list = (strong.length ? strong : matches).slice(0, 3).map((m) => `"${m.content}"`).join(", ");
      text = `I'm not sure which memory you mean, so I didn't delete anything. Closest: ${list}. Repeat with more of its exact words, or delete it in the Memory Vault.`;
    } else {
      matches.splice(0, matches.length, strong[0]!);
      const target = matches[0]!;
      stores.memories.delete(target.id);
      stores.audit.record("memory.deleted", "owner", target.id, { via: "chat" });
      emit({ type: "memory_forgotten", memory: { id: target.id, content: target.content } });
      text = `Forgotten. I deleted: "${target.content}". It won't be used again.` + (matches.length > 1 ? " If you meant a different one, check the Memory Vault." : "");
    }
    emit({ type: "delta", text });
    return finish(text, "complete");
  }

  // Reminders and timers are parsed by code so they work with any brain, then go through the same action policy.
  const timeIntent = intent.type === "chat" && deps.actions ? detectTimeIntent(content) : null;
  if (timeIntent && deps.actions) {
    let text: string;
    if (timeIntent.type === "reminder") {
      const minutes = (timeIntent.due.getTime() - Date.now()) / 60_000;
      const { execution } = await deps.actions.propose("create_reminder", { text: timeIntent.text, minutes_from_now: Math.max(minutes, 0.01) }, { conversationId, requestedBy: "command" });
      if (execution) recordTool(toEvent(execution));
      text =
        execution?.status === "succeeded"
          ? `Reminder set: "${timeIntent.text}" ${timeIntent.label} (${timeIntent.due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}). I'll pop it up and say it out loud.`
          : execution?.status === "awaiting_approval"
            ? `I've prepared a reminder for "${timeIntent.text}" ${timeIntent.label}. Approve it in the app to schedule it.`
            : `I couldn't set that reminder: ${execution?.error ?? "unknown problem"}`;
    } else if (timeIntent.type === "list_reminders") {
      const items = stores.reminders.list().filter((r) => r.status === "scheduled" || r.status === "missed");
      text = items.length
        ? `You have ${items.length} reminder${items.length > 1 ? "s" : ""}:\n` +
          items.map((r) => `• ${r.text}, ${new Date(r.dueAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}${r.status === "missed" ? " (missed while I was off)" : ""}`).join("\n")
        : "You have no upcoming reminders.";
    } else {
      const upcoming = stores.reminders.upcoming();
      const target = matchReminder(upcoming, timeIntent.query);
      if (!target) {
        text = upcoming.length ? `Which one? You have: ${upcoming.map((r) => `"${r.text}"`).join(", ")}.` : "You have no upcoming reminders to cancel.";
      } else {
        const { execution } = await deps.actions.propose("cancel_reminder", { reminder_id: target.id }, { conversationId, requestedBy: "command" });
        if (execution) recordTool(toEvent(execution));
        text = execution?.status === "succeeded" ? `Cancelled the reminder "${target.text}".` : `I couldn't cancel it: ${execution?.error ?? "needs your approval in the app"}`;
      }
    }
    emit({ type: "delta", text });
    return finish(text, "complete");
  }

  // Everyday commands answered by code: instant, and reliable even on a small local model.
  const quick = intent.type === "chat" && !timeIntent && deps.actions ? detectQuickCommand(content) : null;
  if (quick && deps.actions) {
    const run = async (tool: string, args: Record<string, unknown>) => {
      const r = await deps.actions!.propose(tool, args, { conversationId, requestedBy: "command" });
      if (r.execution) recordTool(toEvent(r.execution));
      let data: any = null;
      try {
        data = JSON.parse(r.resultForModel);
      } catch {
        data = null;
      }
      return { status: r.execution?.status ?? "failed", error: r.execution?.error ?? data?.error ?? null, data };
    };
    const text = await quickReply(quick, run, stores);
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
    if (target.ok && target.where === "cloud" && opts.inputMode === "voice") {
      const text = `Switching to a cloud brain sends your conversations off this PC, so I don't do that from voice alone. Type "switch to ${intent.target}" to confirm.`;
      emit({ type: "delta", text });
      return finish(text, "complete");
    }
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

  // Keyword recall always; meaning-based recall too once the local embedding model is ready.
  const semantic = (await deps.embeddings?.similar(content).catch(() => [])) ?? [];
  const memories = semantic.length ? stores.memories.retrieveHybrid(content, semantic) : stores.memories.retrieveForPrompt(content);
  if (memories.length) emit({ type: "memories", memories: memories.map(brief) });
  const capabilities = currentCapabilities(settings, resolution, deps.stt?.(), deps.ttsEngine?.());
  const provider = resolution.provider;
  const turnsSoFar = historyFor(stores.conversations.messages(conversationId).filter((m) => m.id !== assistant.id));
  // Small local models do better with only the tools this conversation plausibly needs (see focus.ts).
  const recentUser = turnsSoFar.filter((t) => t.role === "user").slice(-2).map((t) => t.content);
  const toolSet = provider.id === "ollama" ? focusTools(recentUser, TOOLS) : TOOLS;
  const toolSpecs = specsFor(toolSet);
  const useTools = Boolean(provider.streamWithTools && deps.actions) && toolSet.length > 0;
  const system = buildSystemPrompt(deps.persona(), {
    capabilities,
    toolsEnabled: useTools,
    localTime: new Date().toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }) + ` (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    memories,
    nowIso: new Date().toISOString(),
    rapport: { ...rapportFor(stores, conversationId, opts.inputMode), recentMemories: recentMemories(stores, memories) },
  });
  const turns: ChatTurn[] = turnsSoFar;

  let text = "";
  let lastFlush = Date.now();
  let callsThisTurn = 0;
  try {
    // Model ↔ tools loop, bounded so a confused model can't spin (cost and safety cap).
    for (let round = 0; round <= MAX_TOOL_ROUNDS && !opts.signal.aborted; round++) {
      const req = { system, messages: turns, memories, capabilities, signal: opts.signal };
      const events = useTools && round < MAX_TOOL_ROUNDS ? provider.streamWithTools!({ ...req, tools: toolSpecs }) : textOnly(provider.stream(req));
      const calls: ToolCall[] = [];
      let roundText = "";
      for await (const ev of events) {
        if (opts.signal.aborted) break;
        if (ev.type === "tool_call") {
          calls.push(ev.call);
          continue;
        }
        text += ev.text;
        roundText += ev.text;
        emit({ type: "delta", text: ev.text });
        // Persist partial text periodically so a crash keeps what was already said.
        if (Date.now() - lastFlush > 1000) {
          stores.conversations.updateMessage(assistant.id, { content: text });
          lastFlush = Date.now();
        }
      }
      if (!calls.length || opts.signal.aborted) break;
      turns.push({ role: "assistant", content: roundText, toolCalls: calls });
      for (const call of calls) {
        // A runaway (or manipulated) model can't flood reminders or approval cards.
        if (++callsThisTurn > MAX_CALLS_PER_TURN) {
          turns.push({ role: "tool", content: JSON.stringify({ error: `Too many actions in one reply (limit ${MAX_CALLS_PER_TURN}). This one was not run.` }), toolCallId: call.id, name: call.name });
          continue;
        }
        const { execution, resultForModel } = await deps.actions!.propose(call.name, call.args, { conversationId, requestedBy: "model" });
        if (execution) recordTool(toEvent(execution));
        turns.push({ role: "tool", content: resultForModel, toolCallId: call.id, name: call.name });
      }
      if (text && !/\s$/.test(text)) {
        text += " ";
        emit({ type: "delta", text: " " });
      }
    }
    // Safety net: a reply that claims an action when none ran gets corrected in plain sight.
    if (deps.actions && !opts.signal.aborted && toolEvents.length === 0 && claimsUnbackedAction(text)) {
      text += HONESTY_NOTE;
      emit({ type: "delta", text: HONESTY_NOTE });
      stores.audit.record("model.unbacked_claim", "system", assistant.id, { provider: providerId });
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

/** "3 hours ago", "yesterday", "2 weeks ago": how a friend would put it. */
export function humanAgo(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 2) return "a moment ago";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

/** Catch-up context: when the owner last talked to ULTRON and what about (other conversations only). */
export function rapportFor(stores: Stores, conversationId: string, inputMode?: "text" | "voice") {
  const others = stores.conversations.list().filter((c) => c.id !== conversationId && c.title !== "New conversation");
  const current = stores.conversations.messages(conversationId).filter((m) => m.role === "user");
  // Earlier in this same conversation counts too (the last message before this one).
  const prevHere = current.length >= 2 ? current[current.length - 2]!.createdAt : null;
  const lastOther = others[0]?.updatedAt ?? null;
  const last = [prevHere, lastOther].filter(Boolean).sort().at(-1) ?? null;
  return {
    lastChat: last ? humanAgo(Date.now() - new Date(last).getTime()) : null,
    recentTopics: others.slice(0, 5).map((c) => c.title.slice(0, 80)),
    inputMode,
  };
}

/** Up to 4 memories from the last 14 days that weren't already retrieved for this message. */
export function recentMemories(stores: Stores, already: { id: string }[], now = Date.now()) {
  const have = new Set(already.map((m) => m.id));
  return stores.memories
    .list()
    .filter((m) => !have.has(m.id) && m.sensitivity !== "sensitive" && now - new Date(m.createdAt).getTime() < 14 * 86_400_000)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
}

/** Greetings and pleasantries that shouldn't become a conversation's title. */
export function isSmallTalk(text: string): boolean {
  const t = text.toLowerCase().replace(/\bultron\b/g, "").replace(/[^\p{L}\s']/gu, " ").replace(/\s+/g, " ").trim();
  if (!t) return true;
  return /^(?:(?:hi|hey|hello|yo|sup|hiya|howdy|ok|okay|thanks|thank you|cheers|good (?:morning|afternoon|evening|night)|morning|evening|i'm back|im back|what's up|whats up|how are you|how's it going|you there|are you there)\s*)+$/.test(t);
}

type QuickRun = (tool: string, args: Record<string, unknown>) => Promise<{ status: string; error: string | null; data: any }>;

/** Plain, friendly replies for the quick commands, built only from what the tools actually returned. */
async function quickReply(q: NonNullable<ReturnType<typeof detectQuickCommand>>, run: QuickRun, stores: Stores): Promise<string> {
  const failed = (r: { status: string; error: string | null }) =>
    r.status === "denied" ? `I can't do that right now: ${r.error ?? "actions are paused"}.` : `That didn't work: ${r.error ?? "unknown problem"}.`;
  switch (q.type) {
    case "open_url": {
      const r = await run("open_website", { url: q.url });
      if (r.status === "awaiting_approval") return `Opening ${new URL(q.url).host} needs your OK: click Approve on the card below and it opens in your browser.`;
      return r.status === "succeeded" ? `Opened ${new URL(q.url).host} in your browser.` : failed(r);
    }
    case "add_todo": {
      const r = await run("add_todo", { items: q.items });
      if (r.status !== "succeeded") return failed(r);
      const added: string[] = (r.data?.added ?? []).map((t: { text: string }) => t.text);
      const dupes: string[] = r.data?.already_on_list ?? [];
      const parts = [];
      if (added.length) parts.push(`Added to your list: ${added.join(", ")}.`);
      if (dupes.length) parts.push(`${dupes.join(", ")} ${dupes.length === 1 ? "was" : "were"} already on it.`);
      parts.push(`${r.data?.open_items ?? "?"} open item${r.data?.open_items === 1 ? "" : "s"} now.`);
      return parts.join(" ");
    }
    case "list_todos": {
      const r = await run("list_todos", {});
      if (r.status !== "succeeded") return failed(r);
      const open: { text: string; due?: string }[] = r.data?.open ?? [];
      if (!open.length) return "Your list is empty. Either you're very organised or very good at avoiding lists.";
      return `On your list (${open.length}):\n${open.map((t) => `• ${t.text}${t.due ? ` (due ${t.due})` : ""}`).join("\n")}`;
    }
    case "weather": {
      const r = await run("get_weather", q.place ? { place: q.place } : {});
      if (r.status !== "succeeded") return failed(r);
      const w = r.data;
      if (!w?.found) return w?.note?.includes("home city") ? "I don't know where you are yet. Set your home city in Settings → Personality, or ask \"weather in <city>\"." : (w?.note ?? "I couldn't get the weather.");
      const today = w.next_days?.[0];
      const tomorrow = w.next_days?.[1];
      const lines = [`Right now in ${w.place}: ${w.now.conditions}, ${w.now.temperature} (feels like ${w.now.feels_like}), wind ${w.now.wind}.`];
      if (today) lines.push(`Today: ${today.low} to ${today.high}${today.chance_of_rain ? `, ${today.chance_of_rain} chance of rain` : ""}.`);
      if (tomorrow) lines.push(`Tomorrow: ${tomorrow.conditions}, ${tomorrow.low} to ${tomorrow.high}.`);
      if (today?.chance_of_rain && parseInt(today.chance_of_rain) >= 50) lines.push("Take an umbrella. I'd hate for you to rust.");
      return lines.join(" ");
    }
    case "calculate": {
      const r = await run("calculate", { expression: q.expression });
      if (r.status !== "succeeded") return `I couldn't work that out: ${r.data?.error ?? r.error ?? "that doesn't look like maths I can do"}.`;
      return `${q.expression} = ${Number(r.data.result).toLocaleString(undefined, { maximumFractionDigits: 10 })}`;
    }
  }
  void stores;
}

