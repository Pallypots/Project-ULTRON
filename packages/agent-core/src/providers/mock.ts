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
    const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
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
    if (explicit) return { name: explicit[1]!, args: explicit[2] ? (JSON.parse(explicit[2]) as Record<string, unknown>) : {} };
    if (has("get_current_time") && /\bwhat(?:'s| is) the (?:time|date)|what time is it|what day is it/i.test(text)) return { name: "get_current_time", args: {} };
    if (has("daily_briefing") && /good morning|brief me|what'?s my day|catch me up/i.test(text)) return { name: "daily_briefing", args: {} };
    if (has("connected_updates") && /what'?s new|any updates/i.test(text)) return { name: "connected_updates", args: /github/i.test(text) ? { source: "github" } : {} };
    const files = /\b(?:search (?:my )?files for|find (?:my )?files about|pull up)\s+(.+?)[?.!]*$/i.exec(text);
    if (files && has("search_files")) return { name: "search_files", args: { query: files[1] } };
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
    const tool = this.pickTool(req, req.tools);
    if (tool) {
      yield { type: "text", text: "On it. " };
      yield { type: "tool_call", call: { id: newToolCallId(), ...tool } };
      return;
    }
    for await (const t of this.emitText(this.reply(req), req.signal)) yield { type: "text", text: t };
  }
}
