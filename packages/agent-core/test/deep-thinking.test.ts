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

describe("robust streaming from the local brain (Phase 1.13)", () => {
  const streamOf = (lines: string[]) =>
    (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const l of lines) c.enqueue(new TextEncoder().encode(l + "\n"));
            c.close();
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
  const say = async (lines: string[]) => {
    const p = new OllamaProvider({ model: "gemma4:e2b", baseUrl: "http://ollama.test", fetchImpl: streamOf(lines) });
    let out = "";
    for await (const t of p.stream({ system: "s", messages: [{ role: "user", content: "hi" }], memories: [] })) out += t;
    return out;
  };
  const piece = (content: string, done = false) => JSON.stringify({ message: { content }, done });
  it("survives a garbled line and hides thinking even when its tag arrives split in two", async () => {
    const out = await say([piece("Hello <thi"), "{not json", piece("nk>secret plan</th"), piece("ink> world."), piece("", true)]);
    expect(out).toBe("Hello  world.");
    expect(out).not.toContain("secret");
  });
  it("leaves ordinary text with a '<' alone", async () => {
    expect(await say([piece("If a <"), piece(" b then"), piece(" stop.", true)])).toBe("If a < b then stop.");
  });
});

describe("tool calls a small model writes out as text", async () => {
  const { LeakedToolCalls } = await import("../src/providers/ollama.ts");
  const feed = (chunks: string[], names = ["calculate", "save_memory"]) => {
    const l = new LeakedToolCalls(names);
    let text = "";
    const calls: unknown[] = [];
    chunks.forEach((c, i) => {
      const r = l.push(c, i === chunks.length - 1);
      text += r.text;
      calls.push(...r.calls);
    });
    return { text, calls };
  };

  it("turns Gemma's written-out call into a real one, even split across chunks, and never shows it", () => {
    const r = feed(["Let me work that out. <|to", 'ol_call>call:calculate{expression:<|"|>1299*0.85+4.99<|"|>}<tool', "_call|>", ""]);
    expect(r.calls).toEqual([{ name: "calculate", args: { expression: "1299*0.85+4.99" } }]);
    expect(r.text).toBe("Let me work that out. ");
  });

  it("understands the JSON form too", () => {
    expect(feed(['<tool_call>{"name":"calculate","arguments":{"expression":"2+2"}}</tool_call>', ""]).calls).toEqual([{ name: "calculate", args: { expression: "2+2" } }]);
  });

  it("negative controls: ordinary text with < passes through; unknown tools and unfinished calls are dropped, not shown", () => {
    expect(feed(["3 < 4 and <b>bold</b>", " done<"]).text).toBe("3 < 4 and <b>bold</b> done<");
    const unknown = feed(['<|tool_call>call:format_disk{drive:<|"|>C<|"|>}<tool_call|>Okay.', ""]);
    expect(unknown.calls).toEqual([]);
    expect(unknown.text).toBe("Okay.");
    const cut = feed(["Sure <|tool_call>call:calculate{expr", ""]);
    expect(cut.calls).toEqual([]);
    expect(cut.text).toBe("Sure ");
  });
});

describe("a made-up tool answer after a written-out call", async () => {
  const { LeakedToolCalls } = await import("../src/providers/ollama.ts");
  it("is never shown (ULTRON runs the real tool instead)", () => {
    const l = new LeakedToolCalls(["calculate"]);
    const a = l.push('<|tool_call>call:calculate{expression:<|"|>2+2<|"|>}<tool_call|><|tool_resp', false);
    const b = l.push("onse>result: 5<tool_response|>So it's 5.", true);
    expect(a.calls).toEqual([{ name: "calculate", args: { expression: "2+2" } }]);
    expect(a.text + b.text).toBe("");
  });
});

describe("a tool call written out with no markers at all", async () => {
  const { LeakedToolCalls } = await import("../src/providers/ollama.ts");
  it("becomes a real call, even split across chunks; ordinary words and braces stay", () => {
    const l = new LeakedToolCalls(["get_weather", "calculate"]);
    const a = l.push("Let me check. get_wea", false);
    const b = l.push('ther{place:<|"|>Paris<|"|>, when:<|"|>tomorrow<|"|>}', false);
    const c = l.push(" Done.", true);
    expect([...a.calls, ...b.calls, ...c.calls]).toEqual([{ name: "get_weather", args: { place: "Paris", when: "tomorrow" } }]);
    expect(a.text + b.text + c.text).toBe("Let me check.  Done.");
    // Negative controls: a word that only starts like a tool name, and braces in prose, pass through.
    const n = new LeakedToolCalls(["get_weather", "calculate"]);
    expect([n.push("I can calc", false), n.push("ulate that in {my head}.", true)].map((r) => r.text).join("")).toBe("I can calculate that in {my head}.");
  });
});
