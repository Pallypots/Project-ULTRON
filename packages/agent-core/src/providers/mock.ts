import { newToolCallId, type ModelProvider, type ModelRequest, type ProviderEvent, type ToolSpec } from "./types.ts";

/**
 * Deterministic offline provider: no API key, no network. Used for first run and CI.
 * With tools it follows simple scripted rules so the action pipeline can be tested end to end.
 */
export class MockProvider implements ModelProvider {
  readonly id = "mock";
  readonly model = "ultron-mock-1";

  constructor(private delayMs = 15) {}

  reply(req: ModelRequest): string {
    const lastTurn = req.messages.at(-1);
    if (lastTurn?.role === "tool") {
      // Report tool outcomes honestly: waiting and refused are not "done".
      if (lastTurn.content.includes("waiting_for_owner_approval")) return `That needs your approval first. I've put a request in the app (${lastTurn.name}); nothing has happened yet.`;
      if (/"(status|error)":\s*"?(refused|failed)|"error":/.test(lastTurn.content)) return `I couldn't do that. The ${lastTurn.name} tool said: ${lastTurn.content}`;
      return `Done. The ${lastTurn.name} tool reported: ${lastTurn.content}`;
    }
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const last = lastUser?.content ?? "";
    // The test brain can't see, but it says honestly what it was given.
    if (lastUser?.role === "user" && lastUser.images?.length) return `I was shown ${lastUser.images.length} image${lastUser.images.length > 1 ? "s" : ""} (${lastUser.images.map((i) => `${Math.round((i.length * 3) / 4 / 1024)} KB`).join(", ")}). The test brain can't actually see; switch to a vision-capable brain to describe it.`;
    const parts: string[] = [];
    if (req.capabilities?.length && /what can you do|capabilit|what are you able/i.test(last)) {
      parts.push("Here's exactly what I can do right now:");
      for (const c of req.capabilities) parts.push(`• ${c.label}: ${c.status.replace("_", " ")}${c.detail ? ` (${c.detail})` : ""}`);
    } else if (req.memories.length) {
      parts.push("Here's what I have on record that looks relevant:");
      for (const m of req.memories) parts.push(`• ${m.content} [memory:${m.id.slice(0, 8)}]`);
    } else {
      parts.push(`Offline mock mode. You said: "${last}".`);
    }
    parts.push("(I'm running on the built-in mock model. Connect Claude, OpenAI, or a local model in Settings for real conversation.)");
    return parts.join("\n");
  }

  /** Scripted tool use: "what time" → get_current_time; "open <url>" → open_website; "mock-tool <name> <json>" → that tool. */
  private pickTool(req: ModelRequest, tools: ToolSpec[]): { name: string; args: Record<string, unknown> } | null {
    const lastTurn = req.messages.at(-1);
    if (!lastTurn || lastTurn.role !== "user") return null;
    const text = lastTurn.content;
    const has = (n: string) => tools.some((t) => t.name === n);
    const explicit = /^mock-tool\s+(\w+)\s*(\{.*\})?\s*$/s.exec(text);
    const draft = /^draft (?:a |an )?(?:github )?issue (?:in|for|on) ([\w.-]+\/[\w.-]+)[:,]?\s+(.+)$/is.exec(text);
    if (!explicit && draft && has("github_create_issue"))
      return { name: "github_create_issue", args: { repo: draft[1], title: draft[2]!.slice(0, 80), body: `**What happened**\n${draft[2]}\n\n**Steps to reproduce**\n1. …` } };
    if (explicit) return { name: explicit[1]!, args: explicit[2] ? (JSON.parse(explicit[2]) as Record<string, unknown>) : {} };
    if (has("get_current_time") && /\bwhat(?:'s| is) the (?:time|date)|what time is it|what day is it/i.test(text)) return { name: "get_current_time", args: {} };
    if (has("daily_briefing") && /good morning|brief me|what'?s my day|catch me up/i.test(text)) return { name: "daily_briefing", args: {} };
    if (has("connected_updates") && /what'?s new|any updates/i.test(text)) return { name: "connected_updates", args: /github/i.test(text) ? { source: "github" } : {} };
    const files = /\b(?:search (?:my )?files for|find (?:my )?files about|pull up)\s+(.+?)[?.!]*$/i.exec(text);
    if (files && has("search_files")) return { name: "search_files", args: { query: files[1] } };
    const sum = /^(?:calculate|what(?:'s| is))\s+([\d(.][\d\s+\-*/^%().,]*?)\s*\??$/i.exec(text);
    if (sum && has("calculate")) return { name: "calculate", args: { expression: sum[1]!.trim() } };
    const weather = /\bweather(?:\s+(?:in|for|at)\s+([\p{L} ,.'-]+?))?\s*[?.!]*$/iu.exec(text);
    if (weather && has("get_weather")) return { name: "get_weather", args: weather[1] ? { place: weather[1] } : {} };
    const wiki = /^(?:look up|who (?:is|was)|tell me about)\s+(.+?)[?.!]*$/i.exec(text);
    if (wiki && has("lookup_wikipedia")) return { name: "lookup_wikipedia", args: { topic: wiki[1] } };
    const read = /\b(?:summari[sz]e|read)\s+(https?:\/\/\S+)/i.exec(text);
    if (read && has("read_webpage")) return { name: "read_webpage", args: { url: read[1] } };
    // A personal fact ("my sister's birthday is March 3") → offer to remember it, like a real model is told to.
    const fact = /^(?:ultron[,\s]+)?my\s+(.{3,120}?)\s+(is|are|was)\s+(.{2,120}?)[.!]*$/i.exec(text);
    if (fact && has("save_memory")) return { name: "save_memory", args: { content: `Their ${fact[1]} ${fact[2]} ${fact[3]}` } };
    if (has("recall_everything_about_owner") && /what do you (?:know|remember) about me|what have you learned about me/i.test(text)) return { name: "recall_everything_about_owner", args: {} };
    const past = /^(?:what did (?:we|i) (?:say|talk about|discuss) about|did i (?:mention|tell you about))\s+(.+?)[?.!]*$/i.exec(text);
    if (past && has("search_conversations")) return { name: "search_conversations", args: { query: past[1] } };
    const addTodo = /^add\s+(.+?)\s+to\s+my\s+(?:to-?do\s+)?list[.!]*$/i.exec(text);
    if (addTodo && has("add_todo")) return { name: "add_todo", args: { items: addTodo[1]!.split(/\s*(?:,|\band\b)\s*/).filter(Boolean) } };
    if (has("list_todos") && /what'?s on my (?:to-?do )?list|show my (?:to-?do )?list/i.test(text)) return { name: "list_todos", args: {} };
    const did = /^(?:i (?:finished|did|paid|bought|called|sent)|tick off|mark)\s+(.+?)(?:\s+(?:as\s+)?done)?[.!]*$/i.exec(text);
    if (did && has("complete_todo")) return { name: "complete_todo", args: { item: did[1] } };
    const url = /\bopen\s+(https?:\/\/\S+)/i.exec(text);
    if (url && has("open_website")) return { name: "open_website", args: { url: url[1] } };
    return null;
  }

  private async *emitText(text: string, signal?: AbortSignal): AsyncIterable<string> {
    for (const t of text.split(/(?<=\s)/)) {
      if (signal?.aborted) return;
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      yield t;
    }
  }

  async *stream(req: ModelRequest): AsyncIterable<string> {
    yield* this.emitText(this.reply(req), req.signal);
  }

  async *streamWithTools(req: ModelRequest & { tools: ToolSpec[] }): AsyncIterable<ProviderEvent> {
    // Test hook: "mock-flood <tool> <n>" simulates a runaway model emitting many calls at once.
    const last = req.messages.at(-1);
    const flood = last?.role === "user" ? /^mock-flood (\w+) (\d+)$/.exec(last.content) : null;
    if (flood) {
      for (let i = 0; i < Number(flood[2]); i++)
        yield { type: "tool_call", call: { id: newToolCallId(), name: flood[1]!, args: flood[1] === "create_reminder" ? { text: `flood ${i}`, minutes_from_now: 60 } : {} } };
      return;
    }
    const tool = this.pickTool(req, req.tools);
    if (tool) {
      yield { type: "text", text: "On it. " };
      yield { type: "tool_call", call: { id: newToolCallId(), ...tool } };
      return;
    }
    for await (const t of this.emitText(this.reply(req), req.signal)) yield { type: "text", text: t };
  }
}
