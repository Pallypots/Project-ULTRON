import { afterEach, describe, expect, it } from "vitest";
import { OllamaProvider, detectIntent } from "@ultron/agent-core";
import { recommendModel } from "../src/local-ai/recommend.ts";
import { detectHardware, pickUsableGpu } from "../src/local-ai/hardware.ts";
import { resolveBrain, type BrainContext } from "../src/brains.ts";
import { startFakeOllama, type FakeOllama } from "./fake-ollama.ts";
import { replyText, startGateway } from "./helpers.ts";

const GB = 1024 ** 3;
let fake: FakeOllama | null = null;
let cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
  await fake?.close();
  fake = null;
});

async function setup() {
  fake = await startFakeOllama();
  process.env.ULTRON_OLLAMA_URL = fake.url;
  const g = await startGateway();
  cleanup.push(g.close);
  delete process.env.ULTRON_OLLAMA_URL;
  return g;
}

describe("Ollama provider", () => {
  it("streams the answer, hides thinking, and asks for no thinking", async () => {
    fake = await startFakeOllama();
    const p = new OllamaProvider({ model: "gemma4:e2b", baseUrl: fake.url });
    let out = "";
    for await (const t of p.stream({ system: "sys", messages: [{ role: "user", content: "hi" }], memories: [] })) out += t;
    expect(out).toBe("Hello from local.");
    const req = fake.requests.find((r) => r.path === "/api/chat")!.body;
    expect(req.think).toBe(false);
    expect(req.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("retries without `think` for models that don't support it", async () => {
    fake = await startFakeOllama();
    fake.rejectThink = true;
    const p = new OllamaProvider({ model: "gemma4:e2b", baseUrl: fake.url });
    let out = "";
    for await (const t of p.stream({ system: "", messages: [{ role: "user", content: "hi" }], memories: [] })) out += t;
    expect(out).toBe("Hello from local.");
  });

  it("explains missing models and a stopped Ollama in plain English", async () => {
    fake = await startFakeOllama();
    const missing = new OllamaProvider({ model: "qwen3:8b", baseUrl: fake.url });
    await expect(async () => {
      for await (const _ of missing.stream({ system: "", messages: [{ role: "user", content: "x" }], memories: [] }));
    }).rejects.toThrow(/isn't downloaded/);
    const down = new OllamaProvider({ model: "gemma4:e2b", baseUrl: "http://127.0.0.1:9" });
    await expect(async () => {
      for await (const _ of down.stream({ system: "", messages: [{ role: "user", content: "x" }], memories: [] }));
    }).rejects.toThrow(/isn't running/);
  });
});

describe("hardware-based recommendation", () => {
  const gpu = (name: string, gb: number) => ({ name, vramBytes: gb * GB, vendor: "nvidia" as const });
  it.each([
    [null, 8, "gemma4:e2b"],
    [null, 32, "gemma4:e2b"],
    [gpu("RTX 3050", 4), 16, "qwen3:4b"],
    [gpu("RTX 4060", 8), 16, "qwen3:8b"],
    [gpu("RTX 4080", 16), 32, "gpt-oss:20b"],
    [gpu("RTX 4090", 24), 64, "gemma4:31b"],
  ])("%o + %i GB RAM -> %s", (g, ram, model) => {
    expect(recommendModel({ usableGpu: g, ramBytes: ram * GB }).primary.model).toBe(model);
  });
  it("detects this machine's hardware without throwing (runs the real Windows/NVIDIA probes in CI)", async () => {
    const hw = await detectHardware(true);
    expect(hw.ramBytes).toBeGreaterThan(0);
    expect(Array.isArray(hw.gpus)).toBe(true);
    const summary = `ram=${(hw.ramBytes / GB).toFixed(1)}GB gpus=${JSON.stringify(hw.gpus.map((g) => `${g.name} ${(g.vramBytes / GB).toFixed(1)}GB ${g.vendor}`))} recommend=${recommendModel(hw).primary.model}`;
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Hardware detection (${process.platform})::${summary}`);
  }, 30_000);
  it("ignores integrated graphics Ollama can't use", () => {
    expect(pickUsableGpu([{ name: "Intel(R) UHD Graphics", vramBytes: 4 * GB, vendor: "intel" }, gpu("GeForce RTX 3060 Laptop GPU", 6)])?.name).toMatch(/3060/);
    expect(pickUsableGpu([{ name: "Intel(R) Iris(R) Xe", vramBytes: 1 * GB, vendor: "intel" }])).toBeNull();
  });
});

describe("brain switching intents", () => {
  it.each([
    ["Ultron, switch your brain to Fable 5", "Fable 5"],
    ["switch to the local brain", "local"],
    ["go offline", "local"],
    ["Hey Ultron, change your model to gemma4:e2b", "gemma4:e2b"],
    ["use claude", "claude"],
  ])("%s", (text, target) => {
    expect(detectIntent(text)).toEqual({ type: "switch_brain", target });
  });
  it.each(["use this recipe to make dinner tonight please", "switch to dark mode", "can you switch the lights off"])("not a brain switch: %s", (text) => {
    expect(detectIntent(text).type).toBe("chat");
  });

  const ctx = (o: Partial<BrainContext> = {}): BrainContext => ({
    current: { provider: "mock", model: "", baseUrl: "" },
    lastModels: {},
    installedLocal: ["gemma4:e2b", "qwen3:8b"],
    keys: { anthropic: false, openai: false },
    ...o,
  });
  it("resolves local names and refuses cloud brains without keys", () => {
    expect(resolveBrain("local", ctx())).toMatchObject({ ok: true, settings: { provider: "ollama", model: "gemma4:e2b" }, where: "local" });
    expect(resolveBrain("qwen", ctx())).toMatchObject({ ok: true, settings: { model: "qwen3:8b" } });
    expect(resolveBrain("Fable 5", ctx())).toMatchObject({ ok: false });
    expect(resolveBrain("Fable 5", ctx({ keys: { anthropic: true, openai: false } }))).toMatchObject({ ok: true, settings: { provider: "anthropic", model: "claude-fable-5-1" }, where: "cloud" });
    expect(resolveBrain("local", ctx({ installedLocal: null }))).toMatchObject({ ok: false, message: expect.stringMatching(/isn't running/) });
    expect(resolveBrain("local", ctx({ installedLocal: [] }))).toMatchObject({ ok: false, message: expect.stringMatching(/No local model/) });
  });
});

describe("local AI through the gateway", () => {
  it("reports status with hardware and a recommendation", async () => {
    const { api } = await setup();
    const s = (await api("GET", "/api/local-ai/status")).body;
    expect(s.ollama).toMatchObject({ running: true, version: "0.99.0-fake" });
    expect(s.models.map((m: any) => m.name)).toEqual(["gemma4:e2b"]);
    expect(s.hardware.ramGb).toBeGreaterThan(0);
    expect(s.recommendation.primary.model).toMatch(/:/);
  });

  it("downloads a model with progress, then uses it to chat locally", async () => {
    const { api, chat, newConversation } = await setup();
    expect((await api("POST", "/api/local-ai/pull", { model: "qwen3:8b" })).body.status).toBe("downloading");
    for (let i = 0; i < 50; i++) {
      const p = (await api("GET", "/api/local-ai/status")).body.pulls.find((x: any) => x.model === "qwen3:8b");
      if (p.status === "success") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    const done = (await api("GET", "/api/local-ai/status")).body;
    expect(done.pulls[0]).toMatchObject({ status: "success", completedBytes: 4000, totalBytes: 4000 });
    expect((await api("POST", "/api/local-ai/use", { model: "qwen3:8b" })).status).toBe(200);
    expect((await api("GET", "/api/status")).body).toMatchObject({ provider: "ollama", model: "qwen3:8b", where: "local", providerReady: true });
    const events = await chat(await newConversation(), "hello?");
    expect(replyText(events)).toBe("Hello from local.");
    const caps = (await api("GET", "/api/capabilities")).body.capabilities;
    expect(caps.find((c: any) => c.id === "model").detail).toMatch(/running on this computer/);
  });

  it("explains bad model names and refuses to use models that aren't downloaded", async () => {
    const { api } = await setup();
    await api("POST", "/api/local-ai/pull", { model: "nope:1b" });
    await new Promise((r) => setTimeout(r, 100));
    const p = (await api("GET", "/api/local-ai/status")).body.pulls[0];
    expect(p).toMatchObject({ status: "error", detail: expect.stringMatching(/wasn't found/) });
    expect((await api("POST", "/api/local-ai/use", { model: "llama9:70b" })).status).toBe(409);
    expect((await api("POST", "/api/local-ai/pull", { model: "bad name; rm -rf" })).status).toBe(400);
  });

  it("switches brains from chat and records it", async () => {
    const { api, chat, newConversation } = await setup();
    const id = await newConversation();
    const events = await chat(id, "Ultron, switch your brain to local");
    expect(events.find((e) => e.type === "brain_changed")).toMatchObject({ provider: "ollama", model: "gemma4:e2b", where: "local" });
    expect(replyText(events)).toMatch(/running entirely on this computer/);
    expect(replyText(await chat(id, "hi"))).toBe("Hello from local.");
    const denied = await chat(id, "switch to Fable");
    expect(replyText(denied)).toMatch(/needs an Anthropic API key/);
    expect((await api("GET", "/api/status")).body.provider).toBe("ollama");
    const actions = (await api("GET", "/api/activity")).body.events.map((e: any) => e.action);
    expect(actions).toContain("settings.brain_switched");
  });
});
