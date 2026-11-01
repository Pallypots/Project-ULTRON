import { describe, expect, it } from "vitest";
import { OllamaProvider } from "../src/providers/ollama.ts";

// Captures what ULTRON asks the local brain for, answering like Ollama's streaming /api/chat.
function fakeOllama(bodies: any[]) {
  return (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    const lines = [JSON.stringify({ message: { content: "", thinking: "Let me check… 17 × 3 = 51." } }), JSON.stringify({ message: { content: "51." } }), JSON.stringify({ done: true })];
    return new Response(lines.join("\n") + "\n", { status: 200, headers: { "content-type": "application/x-ndjson" } });
  }) as unknown as typeof fetch;
}

describe("deep thinking on request", () => {
  it("turns reasoning on only when asked, and never shows the reasoning as the answer", async () => {
    const bodies: any[] = [];
    const p = new OllamaProvider({ model: "qwen3:8b", fetchImpl: fakeOllama(bodies) });
    const base = { system: "s", messages: [{ role: "user" as const, content: "17 times 3?" }], memories: [] };
    let quick = "";
    for await (const t of p.stream(base)) quick += t;
    let deep = "";
    for await (const t of p.stream({ ...base, deep: true })) deep += t;
    expect(bodies.map((b) => b.think)).toEqual([false, true]);
    expect(deep).toBe("51.");
    expect(quick).toBe("51.");
    const gpt = new OllamaProvider({ model: "gpt-oss:20b", fetchImpl: fakeOllama(bodies) });
    for await (const _ of gpt.stream({ ...base, deep: true })) void _;
    expect(bodies.at(-1).think).toBe("high");
  });
});

describe("warming up the local brain", () => {
  it("loads the model and keeps it loaded, with the same context size every request uses", async () => {
    const calls: { url: string; body: any }[] = [];
    const p = new OllamaProvider({ model: "gemma4:e2b", baseUrl: "http://ollama.test", fetchImpl: (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch });
    await p.warm();
    expect(calls).toEqual([{ url: "http://ollama.test/api/generate", body: { model: "gemma4:e2b", keep_alive: -1, options: { num_ctx: 8192 } } }]);
    // With the real instructions and tools, the warm-up also reads them (one token of output), so they're prefilled.
    await p.warm({ system: "You are ULTRON.", tools: [{ name: "calculate", description: "maths", parameters: {} }] });
    expect(calls[1]).toMatchObject({ url: "http://ollama.test/api/chat", body: { keep_alive: -1, think: false, options: { num_ctx: 8192, num_predict: 1 }, messages: [{ role: "system", content: "You are ULTRON." }, { role: "user", content: "Hi" }] } });
    expect(calls[1]!.body.tools).toHaveLength(1);
  });
});
