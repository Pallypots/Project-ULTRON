import type { ModelProvider, ModelRequest } from "./types.ts";

/** Deterministic offline provider: no API key, no network. Used for first run and CI. */
export class MockProvider implements ModelProvider {
  readonly id = "mock";
  readonly model = "ultron-mock-1";

  constructor(private delayMs = 15) {}

  reply(req: ModelRequest): string {
    const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const parts: string[] = [];
    if (req.memories.length) {
      parts.push("Here's what I have on record that looks relevant:");
      for (const m of req.memories) parts.push(`• ${m.content} [memory:${m.id.slice(0, 8)}]`);
    } else {
      parts.push(`Offline mock mode. You said: "${last}".`);
    }
    parts.push("(I'm running on the built-in mock model. Connect Claude, OpenAI, or a local model in Settings for real conversation.)");
    return parts.join("\n");
  }

  async *stream(req: ModelRequest): AsyncIterable<string> {
    const tokens = this.reply(req).split(/(?<=\s)/);
    for (const t of tokens) {
      if (req.signal?.aborted) return;
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      yield t;
    }
  }
}
