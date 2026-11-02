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
    // Earlier messages are repeated exactly as they were sent (with their own old context), so turn 2 only adds to the end.
    expect(b.messages.slice(0, a.messages.length)).toEqual(a.messages);
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
    // Seen in CI: a copied "[SPOKEN]" label, then the same reply again.
    expect(run(["Why did the programmer quit? He didn't get arrays. [SPO", "KEN] Why did the programmer quit?"]).trimEnd()).toBe("Why did the programmer quit? He didn't get arrays.");
    // A label copied from the instructions at the very start goes; the same word inside a sentence stays.
    expect(run(["Spoken", " I was going to tell you a joke."])).toBe("I was going to tell you a joke.");
    expect(run(["Spoken: Sure."])).toBe("Sure.");
    expect(run(["Spoken word poetry is great. Spoken", " I mean."])).toBe("Spoken word poetry is great. Spoken I mean.");
  });
});

describe("Phase 1.1 (re-revised, from CI evidence): the same core tools with every message", () => {
  const names = (b: { tools?: { function: { name: string } }[] }) => (b.tools ?? []).map((t) => t.function.name);
  it("plain chat and tool requests share identical instructions and core tools; a rarer tool is only appended", async () => {
    const g = await localGateway();
    const id = await g.newConversation();
    const last = () => fake!.requests.filter((r) => r.path === "/api/chat").at(-1)!.body;
    await g.chat(id, "Hey Ultron, how's it going?");
    const a = last();
    await g.chat(id, "What is 1299 times 0.85 plus 4.99 with a 15% discount on top?");
    const b = last();
    await g.chat(id, "Can you check if my inbox has anything from the bank?");
    const c = last();
    // Positive control: same instructions and the same core tools, in the same order, every time → nothing re-read.
    expect(b.messages[0]).toEqual(a.messages[0]);
    expect(names(a)).toEqual(names(b));
    expect(names(a)).toEqual(expect.arrayContaining(["calculate", "get_weather", "save_memory", "open_website"]));
    // A rarer tool the message clearly needs comes after the core ones (so everything before it is still reused).
    expect(names(c).slice(0, names(a).length)).toEqual(names(a));
    expect(names(c).slice(names(a).length)).toContain("check_email");
  });
  it("negative control: the old per-message mode still sends no tools for plain chat", async () => {
    process.env.ULTRON_LOCAL_TOOLS = "focused";
    try {
      const g = await localGateway();
      await g.chat(await g.newConversation(), "Hey Ultron, how's it going?");
      expect(fake!.requests.filter((r) => r.path === "/api/chat").at(-1)!.body.tools).toBeUndefined();
    } finally {
      delete process.env.ULTRON_LOCAL_TOOLS;
    }
  });
});

describe("no emoji in ULTRON's replies", () => {
  it("strips emoji the model writes, keeps ordinary symbols and text", async () => {
    const { stripEmoji } = await import("../src/chat.ts");
    expect(stripEmoji("Done! 🎉 Your timer is set ⏰️ 👍🏽")).toBe("Done! Your timer is set ");
    expect(stripEmoji("👨‍👩‍👧 family")).toBe(" family");
    // Negative controls: these are not emoji and must stay.
    expect(stripEmoji("Settings → Voice, 21°C, 15% off, © 2026, 5 × 3, café")).toBe("Settings → Voice, 21°C, 15% off, © 2026, 5 × 3, café");
  });
});

describe("a reply spoken straight after ULTRON finished talking", () => {
  it("reaches the brain marked as a reaction to the last answer; an ordinary message isn't", async () => {
    const g = await localGateway();
    const id = await g.newConversation();
    const send = (content: string, replyToLast?: boolean) =>
      g.gw.app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { authorization: `Bearer ${g.gw.token}`, host: "localhost:7477" }, payload: { content, inputMode: "voice", ...(replyToLast ? { replyToLast } : {}) } });
    const latest = () => fake!.requests.filter((r) => r.path === "/api/chat").at(-1)!.body.messages.at(-1).content as string;
    await send("tell me about the moon landing");
    expect(latest()).not.toMatch(/direct reaction/);
    await send("no, I meant the second one", true);
    expect(latest()).toMatch(/within seconds of you finishing your last spoken answer[\s\S]*no, I meant the second one/);
  });
});

describe("spoken replies from a local brain are capped in length", () => {
  it("asks for at most ~120 words when spoken to; typed messages and 'think hard' have no cap", async () => {
    const g = await localGateway();
    const id = await g.newConversation();
    const opts = () => fake!.requests.filter((r) => r.path === "/api/chat").at(-1)!.body.options;
    const send = (content: string, inputMode: "voice" | "text") => g.gw.app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { authorization: `Bearer ${g.gw.token}`, host: "localhost:7477" }, payload: { content, inputMode } });
    await send("tell me about the moon landing", "voice");
    expect(opts().num_predict).toBe(180);
    await send("tell me about the moon landing", "text");
    expect(opts().num_predict).toBeUndefined();
    await send("think hard about whether I should buy or lease a car", "voice");
    expect(opts().num_predict).toBeUndefined();
    expect(opts().num_ctx).toBe(8192); // the cap never changes the context size (that would reload the model)
  });
});

describe("a reply that starts by repeating the question", () => {
  it("has the repeat removed; a reply that merely mentions the same words keeps them", async () => {
    const { contextEchoGuard } = await import("../src/chat.ts");
    const run = (q: string, pieces: string[]) => {
      const g = contextEchoGuard(q);
      return pieces.map((p) => g.push(p)).join("") + g.flush();
    };
    expect(run("Who painted the Mona Lisa?", ["Who painted the", " Mona Lisa? Leonardo da Vinci, around 1503."])).toBe("Leonardo da Vinci, around 1503.");
    expect(run("Look at my screen.", ["Look at my screen. Red."])).toBe("Red.");
    // Negative controls.
    expect(run("Who painted the Mona Lisa?", ["Leonardo da Vinci painted the Mona Lisa."])).toBe("Leonardo da Vinci painted the Mona Lisa.");
    expect(run("hi", ["hi there, owner."])).toBe("hi there, owner.");
  });
});
