import { afterEach, describe, expect, it } from "vitest";
import { startFakeOllama, type FakeOllama } from "./fake-ollama.ts";
import { startGateway } from "./helpers.ts";

let fake: FakeOllama | null = null;
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
  await fake?.close();
  fake = null;
});

async function localGateway() {
  fake = await startFakeOllama();
  process.env.ULTRON_OLLAMA_URL = fake.url;
  const g = await startGateway();
  cleanup.push(g.close);
  delete process.env.ULTRON_OLLAMA_URL;
  expect((await g.api("POST", "/api/local-ai/use", { model: "gemma4:e2b" })).status).toBe(200);
  return g;
}

describe("Phase 0: where each reply's time goes", () => {
  it("records each stage and the local model's own timings; an injected delay shows up in exactly that stage", async () => {
    const g = await localGateway();
    const id = await g.newConversation();
    // Negative control: no delay, so the first word comes quickly.
    await g.chat(id, "hello there");
    // Positive control: the brain pauses 500 ms before its first word.
    fake!.firstTokenDelayMs = 500;
    await g.chat(id, "hello again");
    const { recent, summary } = (await g.api("GET", "/api/perf")).body;
    const [slow, fast] = recent;
    expect(fast.kind).toBe("brain");
    expect(fast.llm[0]).toEqual({ loadMs: 12, promptTokens: 321, promptMs: 456, outputTokens: 20, outputMs: 800 });
    expect(fast.marks.first_token - fast.marks.llm_request).toBeLessThan(300);
    expect(slow.marks.first_token - slow.marks.llm_request).toBeGreaterThanOrEqual(480);
    // The delay is in the brain's first word, not in gathering context.
    expect(Math.abs(slow.marks.context_ready - fast.marks.context_ready)).toBeLessThan(300);
    expect(summary.turns).toBe(2);
    expect(summary.promptReading.p50).toBe(456);
  });

  it("takes the browser's measurements (speech recognition, first sound) and refuses unknown turns", async () => {
    const g = await localGateway();
    const id = await g.newConversation();
    await g.chat(id, "hi");
    const turn = (await g.api("GET", "/api/perf")).body.recent[0];
    expect((await g.api("POST", `/api/turns/${turn.id}/client`, { sttMs: 1800, endToSendMs: 2100 })).status).toBe(200);
    expect((await g.api("POST", `/api/turns/${turn.id}/client`, { firstAudioMs: 2900 })).status).toBe(200);
    expect((await g.api("POST", "/api/turns/nope/client", { sttMs: 1 })).status).toBe(404);
    const after = (await g.api("GET", "/api/perf")).body.recent[0];
    expect(after.client).toEqual({ sttMs: 1800, endToSendMs: 2100, firstAudioMs: 2900 });
  });

  it("says plainly whether the brain is on the graphics card (positive) or not (negative)", async () => {
    const g = await localGateway();
    fake!.loaded = [{ name: "gemma4:e2b", size: 3e9, size_vram: 3e9 }];
    expect((await g.api("GET", "/api/perf")).body.diagnosis.join(" ")).toMatch(/running on the graphics card\. Good/);
    fake!.loaded = [{ name: "gemma4:e2b", size: 3e9, size_vram: 0 }];
    expect((await g.api("GET", "/api/perf")).body.diagnosis.join(" ")).not.toMatch(/graphics card\. Good/);
    fake!.loaded = [{ name: "gemma4:e2b", size: 3e9, size_vram: 1e9 }];
    expect((await g.api("GET", "/api/perf")).body.diagnosis.join(" ")).toMatch(/Only 33% of the brain fits/);
  });
});

describe("Phase 1.1: the prompt a local brain keeps prefilled is identical from turn to turn", () => {
  it("sends the same instructions and tools every turn; the changing context rides on the latest message", async () => {
    const g = await localGateway();
    const id = await g.newConversation();
    await g.chat(id, "Remember that my sister is called Ana");
    await g.chat(id, "hello there");
    await new Promise((r) => setTimeout(r, 1100)); // the clock moves on
    await g.chat(id, "what's my sister called and what's the weather like in Leeds?");
    const chats = fake!.requests.filter((r) => r.path === "/api/chat").map((r) => r.body);
    expect(chats.length).toBeGreaterThanOrEqual(2);
    const [a, b] = chats.slice(-2);
    // Positive control: the stable part is byte-identical.
    expect(b.messages[0]).toEqual(a.messages[0]);
    const names = (x: { tools?: { function: { name: string } }[] }) => (x.tools ?? []).map((t) => t.function.name);
    // The core tools come first, in the same order, every turn (an extra tool may be appended at the end).
    expect(names(b).slice(0, names(a).length)).toEqual(names(a));
    expect(b.messages[0].content).not.toMatch(/Current date\/time|Owner-approved memories relevant/);
    // Negative control: the per-turn context does change, and it's attached to the latest owner message.
    const ctx = (x: { messages: { role: string; content: string }[] }) => x.messages.at(-1)!.content.split("[Context for this reply")[1] ?? "";
    expect(ctx(a)).toMatch(/Current date\/time/);
    expect(ctx(b)).not.toBe(ctx(a));
    expect(b.messages.at(-1).content).toMatch(/^\[Context for this reply[\s\S]*\[End of context\. The owner's message follows\.\]\n\nwhat's my sister called/);
    // Earlier messages in the history carry no context (so they stay identical too).
    expect(b.messages.slice(1, -1).some((m: { content: string }) => m.content.includes("[Context for this reply"))).toBe(false);
  });
});

describe("Phase 1.2/1.3: one context size, model kept loaded, history trimmed in blocks", () => {
  it("every request to the local brain asks for the same context size and to stay loaded", async () => {
    const g = await localGateway();
    const id = await g.newConversation();
    await g.chat(id, "hello");
    await g.chat(id, "how are you?");
    const chats = fake!.requests.filter((r) => r.path === "/api/chat").map((r) => r.body);
    expect(chats.length).toBeGreaterThanOrEqual(2);
    for (const c of chats) {
      expect(c.options?.num_ctx).toBe(8192);
      expect(c.keep_alive).toBe(-1);
    }
  });

  it("drops old history in blocks of 8, so the start of the conversation stays put for several turns", async () => {
    const { historyFor } = await import("../src/chat.ts");
    const msg = (i: number) => ({ id: String(i), conversationId: "c", role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `message ${i} ${"x".repeat(990)}`, status: "complete" as const, createdAt: "", memoryIds: [], toolEvents: [], provider: null, model: null, sourceDeviceId: null, inputMode: "text" as const });
    const starts: string[] = [];
    for (let n = 14; n <= 24; n++) {
      const h = historyFor(Array.from({ length: n }, (_, i) => msg(i)), 14_000, 100);
      // Negative control: it really is trimmed to the budget.
      expect(h.reduce((a, t) => a + t.content.length, 0)).toBeLessThanOrEqual(14_000);
      expect(h[0]!.role).toBe("user");
      starts.push(h[0]!.content.slice(0, 11));
    }
    // Positive control: over 11 turns the start moved only in jumps (a one-message slide would change it every turn).
    expect(new Set(starts).size).toBeLessThanOrEqual(3);
  });
});

describe("Phase 1.1 safety net: a copied [Context …] block is never shown or spoken", () => {
  it("cuts the answer where a copied context block starts, even when the marker arrives in pieces", async () => {
    const { contextEchoGuard } = await import("../src/chat.ts");
    const run = (pieces: string[]) => {
      const g = contextEchoGuard();
      return pieces.map((p) => g.push(p)).join("") + g.flush();
    };
    // Positive controls: echoed blocks are cut.
    expect(run(["The screen is red. ", "[Con", "text Sunday 9:56 PM]"]).trimEnd()).toBe("The screen is red.");
    expect(run(["I am 100% confident. [End of context. The owner…"])).toBe("I am 100% confident.");
    // Negative controls: ordinary brackets and words pass through untouched.
    expect(run(["See [1] and [note]: the ", "context matters."])).toBe("See [1] and [note]: the context matters.");
    expect(run(["Done", " [", "C"])).toBe("Done [C");
  });
});

describe("Phase 1.1 (revised): tools only when a message needs them", () => {
  it("ordinary conversation goes with no tools and identical instructions; maths and personal facts still get theirs", async () => {
    const g = await localGateway();
    const id = await g.newConversation();
    const last = () => fake!.requests.filter((r) => r.path === "/api/chat").at(-1)!.body;
    await g.chat(id, "Hey Ultron, how's it going?");
    const a = last();
    await g.chat(id, "I'm thinking of learning the guitar. What do you reckon?");
    const b = last();
    // Positive control: plain chat, no tools, same instructions → the brain reuses what it read.
    expect(a.tools).toBeUndefined();
    expect(b.tools).toBeUndefined();
    expect(b.messages[0]).toEqual(a.messages[0]);
    expect(b.messages[0].content).not.toMatch(/calculate|lookup_wikipedia|save_memory/);
    // Negative controls: messages that need a tool still get exactly that.
    await g.chat(id, "What is 1299 times 0.85 plus 4.99 with a 15% discount on top?");
    expect(last().tools.map((t: { function: { name: string } }) => t.function.name)).toContain("calculate");
    await g.chat(id, "My sister's birthday is March 3rd");
    expect(last().tools.map((t: { function: { name: string } }) => t.function.name)).toContain("save_memory");
  });
});
