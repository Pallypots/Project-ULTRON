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
