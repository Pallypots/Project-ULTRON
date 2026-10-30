import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildSystemPrompt, detectIntent, loadPersona, MockProvider } from "../src/index.ts";

describe("intent detection", () => {
  it.each([
    ["Remember that I prefer instructions that say whether preheating is needed.", "remember"],
    ["Ultron, remember my sister's birthday is March 3", "remember"],
    ["please remember: I use Windows 11", "remember"],
    ["Do you remember what I said?", "chat"],
    ["What do you remember about me?", "chat"],
    ["forget that I use Windows 11", "forget"],
    ["Hey Ultron, forget about the birthday", "forget"],
    ["I always forget my keys", "chat"],
  ])("%s -> %s", (text, type) => {
    expect(detectIntent(text).type).toBe(type);
  });

  it("extracts clean content and classifies kind", () => {
    expect(detectIntent("Remember that I prefer dark roast coffee.")).toMatchObject({ type: "remember", content: "I prefer dark roast coffee", kind: "preference" });
    expect(detectIntent("remember my repo is called oogie-port")).toMatchObject({ kind: "project" });
  });

  it.each([
    "remember my password is hunter2",
    "remember my card 4111 1111 1111 1111",
    "remember my api key sk-abcdefghijklmnop",
    "remember my SSN is 123-45-6789",
  ])("refuses to store credentials: %s", (text) => {
    expect(detectIntent(text).type).toBe("remember_blocked");
  });

  it("flags health/finance details as sensitive", () => {
    expect(detectIntent("remember my medication is taken at 9am")).toMatchObject({ type: "remember", sensitivity: "sensitive" });
  });
});

describe("persona", () => {
  const persona = loadPersona(join(import.meta.dirname, "../../../config/persona.json"));

  it("loads the version-controlled persona", () => {
    expect(persona.name).toBe("ULTRON");
  });

  it("builds a prompt with honest capabilities and cited memories", () => {
    const prompt = buildSystemPrompt(persona, {
      nowIso: "2026-10-30T12:00:00Z",
      capabilities: [{ id: "voice", label: "Voice", status: "not_implemented", detail: "" }],
      memories: [{ id: "abcdef123456", kind: "fact", content: "Owner lives in Dublin", source: "chat", sourceConversationId: null, sourceMessageId: null, confirmed: true, pinned: false, confidence: 1, sensitivity: "normal", reviewAt: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }],
    });
    expect(prompt).toContain("Voice: not_implemented");
    expect(prompt).toContain("[memory:abcdef12]");
    expect(prompt).toMatch(/Never claim consciousness/);
  });
});

describe("mock provider", () => {
  it("streams deterministic output", async () => {
    const p = new MockProvider(0);
    let out = "";
    for await (const t of p.stream({ system: "", messages: [{ role: "user", content: "hi" }], memories: [] })) out += t;
    expect(out).toContain('You said: "hi"');
    let again = "";
    for await (const t of p.stream({ system: "", messages: [{ role: "user", content: "hi" }], memories: [] })) again += t;
    expect(again).toBe(out);
  });
});
