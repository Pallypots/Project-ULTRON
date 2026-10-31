import { afterEach, describe, expect, it } from "vitest";
import { replyText, startGateway, tmpDataDir } from "./helpers.ts";

let cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});
async function gateway(dir?: string) {
  const g = await startGateway(dir);
  cleanup.push(g.close);
  return g;
}

describe("security boundary", () => {
  it("rejects API calls without the session token", async () => {
    const { gw } = await gateway();
    const res = await gw.app.inject({ method: "GET", url: "/api/memories", headers: { host: "localhost:7477" } });
    expect(res.statusCode).toBe(401);
    const bad = await gw.app.inject({ method: "GET", url: "/api/memories", headers: { host: "localhost:7477", authorization: "Bearer wrong" } });
    expect(bad.statusCode).toBe(401);
  });

  it("can't be bypassed with encoded or odd paths (regression: /%61pi/…)", async () => {
    const { gw } = await gateway();
    for (const [method, url] of [["GET", "/%61pi/memories"], ["HEAD", "/%61pi/memories"], ["POST", "/%61pi/stop"], ["GET", "/%61%70%69/actions"], ["GET", "/api/memories/"], ["GET", "/api//memories"], ["GET", "/%61pi/health/../memories"]] as const) {
      const res = await gw.app.inject({ method, url, headers: { host: "localhost:7477" } });
      expect([400, 401, 404], `${method} ${url} -> ${res.statusCode}`).toContain(res.statusCode);
    }
    const bad = await gw.app.inject({ method: "GET", url: "/%E0%A4%A", headers: { host: "localhost:7477" } });
    expect([400, 404]).toContain(bad.statusCode);
    // Health stays public, bootstrap stays loopback-only.
    expect((await gw.app.inject({ url: "/api/health", headers: { host: "localhost:7477" } })).statusCode).toBe(200);
  });

  it("rejects non-loopback Host headers (DNS rebinding) and foreign origins", async () => {
    const { gw } = await gateway();
    const auth = `Bearer ${gw.token}`;
    expect((await gw.app.inject({ url: "/api/health", headers: { host: "evil.example.com" } })).statusCode).toBe(403);
    expect((await gw.app.inject({ url: "/api/bootstrap", headers: { host: "localhost:7477", origin: "https://evil.example.com" } })).statusCode).toBe(403);
    expect((await gw.app.inject({ url: "/api/memories", headers: { host: "localhost:7477", origin: "https://evil.example.com", authorization: auth } })).statusCode).toBe(403);
  });

  it("serves health publicly without leaking internals", async () => {
    const { gw } = await gateway();
    const res = await gw.app.inject({ url: "/api/health", headers: { host: "127.0.0.1:7477" } });
    expect(res.json()).toEqual({ ok: true, name: "ULTRON", version: expect.any(String) });
  });

  it("never returns API keys and never writes them to logs", async () => {
    const { api, gw } = await gateway();
    const key = "sk-ant-test-1234567890abcdefSECRET";
    expect((await api("PUT", "/api/settings/provider", { provider: "anthropic", apiKey: key })).status).toBe(200);
    const settings = await api("GET", "/api/settings/provider");
    expect(JSON.stringify(settings.body)).not.toContain(key);
    expect(settings.body.keys.anthropic).toBe(true);
    // Switch back to mock so later calls don't hit the network.
    await api("PUT", "/api/settings/provider", { provider: "mock" });
    for (const url of ["/api/activity", "/api/status", "/api/capabilities"]) expect(JSON.stringify((await api("GET", url)).body)).not.toContain(key);
    expect(gw.logLines.join("")).not.toContain(key);
    expect(gw.logLines.join("")).not.toContain(gw.token);
    expect((await api("GET", "/api/logs/export")).body).not.toContain(key);
  }, 60_000); // Windows encrypts the key with DPAPI via PowerShell, which can take several seconds per call on a busy CI machine
});

describe("chat", () => {
  it("streams a reply and persists both messages", async () => {
    const { chat, api, newConversation } = await gateway();
    const id = await newConversation();
    const events = await chat(id, "Hello ULTRON");
    expect(events[0]!.type).toBe("start");
    expect(events.filter((e) => e.type === "delta").length).toBeGreaterThan(3);
    expect(events.at(-1)!.type).toBe("done");
    const conv = await api("GET", `/api/conversations/${id}`);
    expect(conv.body.messages.map((m: any) => [m.role, m.status])).toEqual([["user", "complete"], ["assistant", "complete"]]);
    // Small talk doesn't name the conversation; the first real message does.
    expect(conv.body.conversation.title).toBe("New conversation");
    await chat(id, "Help me plan a birthday dinner");
    expect((await api("GET", `/api/conversations/${id}`)).body.conversation.title).toBe("Help me plan a birthday dinner");
  });

  it("explains clearly when the chosen provider isn't configured", async () => {
    const { chat, api, newConversation } = await gateway();
    await api("PUT", "/api/settings/provider", { provider: "anthropic" });
    const events = await chat(await newConversation(), "hi");
    const err = events.find((e) => e.type === "error") as any;
    expect(err.code).toBe("provider_not_configured");
    expect(err.message).toMatch(/API key/);
  });

  it("handles 100 consecutive chat requests without failure", async () => {
    const { chat, newConversation, api } = await gateway();
    const id = await newConversation();
    for (let i = 0; i < 100; i++) {
      const events = await chat(id, `message number ${i}`);
      expect(events.at(-1)!.type).toBe("done");
    }
    expect((await api("GET", `/api/conversations/${id}`)).body.messages).toHaveLength(200);
  });

  it("validates input", async () => {
    const { api, newConversation } = await gateway();
    expect((await api("POST", `/api/conversations/${await newConversation()}/messages`, { content: "" })).status).toBe(400);
    expect((await api("POST", `/api/conversations/nope/messages`, { content: "hi" })).status).toBe(404);
  });
});

describe("Phase 1 acceptance: remember -> restart -> recall in a new conversation -> delete", () => {
  it("works end to end", async () => {
    const dir = tmpDataDir();
    const first = await startGateway(dir);
    const c1 = await first.newConversation();
    const saved = await first.chat(c1, "Remember that I prefer instructions that say whether preheating is needed.");
    const memEvent = saved.find((e) => e.type === "memory_saved") as any;
    expect(memEvent.memory.content).toBe("I prefer instructions that say whether preheating is needed");
    expect(memEvent.memory.sourceConversationId).toBe(c1);
    expect(memEvent.memory.kind).toBe("preference");
    await first.close(); // simulate app restart

    const second = await gateway(dir);
    expect((await second.api("GET", "/api/conversations")).body.conversations).toHaveLength(1);
    const c2 = await second.newConversation();
    const recall = await second.chat(c2, "How should you write cooking instructions for me? Mention preheating?");
    const used = recall.find((e) => e.type === "memories") as any;
    expect(used.memories.map((m: any) => m.id)).toContain(memEvent.memory.id);
    expect(replyText(recall)).toContain("preheating is needed");
    const done = recall.at(-1) as any;
    expect(done.message.memoryIds).toContain(memEvent.memory.id);

    // Correct it, then delete it.
    await second.api("PATCH", `/api/memories/${memEvent.memory.id}`, { content: "I prefer instructions that list oven temperature in Celsius" });
    const corrected = await second.chat(c2, "Anything about preheating?");
    expect(corrected.find((e) => e.type === "memories")).toBeUndefined();

    expect((await second.api("DELETE", `/api/memories/${memEvent.memory.id}`)).status).toBe(200);
    const after = await second.chat(c2, "What oven temperature units do I prefer in instructions?");
    expect(after.find((e) => e.type === "memories")).toBeUndefined();
    expect(replyText(after)).not.toContain("Celsius");

    const actions = (await second.api("GET", "/api/activity")).body.events.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["memory.created", "memory.updated", "memory.deleted"]));
  });

  it("'forget ...' in chat removes the memory", async () => {
    const { chat, newConversation, api } = await gateway();
    const id = await newConversation();
    await chat(id, "Remember that my favourite editor is Neovim");
    const events = await chat(id, "Forget that my favourite editor is Neovim");
    expect(events.find((e) => e.type === "memory_forgotten")).toBeDefined();
    expect((await api("GET", "/api/memories")).body.memories).toHaveLength(0);
  });

  it("refuses to store passwords and stores nothing", async () => {
    const { chat, newConversation, api } = await gateway();
    const events = await chat(await newConversation(), "remember my password is hunter2");
    expect(events.find((e) => e.type === "memory_blocked")).toBeDefined();
    expect((await api("GET", "/api/memories")).body.memories).toHaveLength(0);
    expect(JSON.stringify((await api("GET", "/api/activity")).body)).not.toContain("hunter2");
  });
});

describe("memory vault API", () => {
  it("supports create, pin, export and search", async () => {
    const { api } = await gateway();
    const { memory } = (await api("POST", "/api/memories", { content: "Main PC has an RTX 4080", kind: "fact" })).body;
    expect(memory.source).toBe("manual");
    expect((await api("PATCH", `/api/memories/${memory.id}`, { pinned: true })).body.memory.pinned).toBe(true);
    expect((await api("POST", "/api/memories/search", { query: "graphics card RTX" })).body.memories[0].id).toBe(memory.id);
    expect((await api("GET", "/api/memories/export")).body.memories).toHaveLength(1);
    expect((await api("POST", "/api/memories", { content: "" })).status).toBe(400);
  });
});

describe("capabilities", () => {
  it("reports real state, not imagined features", async () => {
    const { api } = await gateway();
    const caps = (await api("GET", "/api/capabilities")).body.capabilities as any[];
    expect(caps.find((c) => c.id === "voice_output").detail).toMatch(/generated on this computer/);
    expect(caps.find((c) => c.id === "voice_input").detail).toMatch(/recognized on this PC/);
    expect(caps.find((c) => c.id === "model").detail).toMatch(/mock/);
  });

  it("answers 'what can you do right now?' from the live capability list", async () => {
    const { chat, newConversation } = await gateway();
    const text = replyText(await chat(await newConversation(), "What can you do right now?"));
    expect(text).toMatch(/Spoken replies: enabled/);
    expect(text).toMatch(/Phone access: enabled \(from the owner.s paired phones over Tailscale/);
    expect(text).toMatch(/Screen viewing: enabled \(only when the owner asks/);
    expect(text).toMatch(/Long-term memory: enabled/);
  });
});

describe("what's new after an update", () => {
  it("stays quiet on first run, then shows changes newer than the last version seen", async () => {
    const { startGateway } = await import("./helpers.ts");
    const g = await startGateway();
    try {
      const first = (await g.api("GET", "/api/whats-new")).body;
      expect(first).toMatchObject({ firstRun: true, sections: [] });
      await g.api("POST", "/api/whats-new/seen");
      expect((await g.api("GET", "/api/whats-new")).body.sections).toEqual([]);
      g.gw.stores.preferences.set("seen_version", "0.17.0"); // as if the owner last used v0.17
      const news = (await g.api("GET", "/api/whats-new")).body;
      expect(news.sections.map((s: { version: string }) => s.version).slice(-2)).toEqual(["0.19.0", "0.18.0"]);
      expect(news.sections.at(-1).items.some((i: string) => /Calendar/.test(i))).toBe(true);
    } finally {
      await g.close();
    }
  });
});
