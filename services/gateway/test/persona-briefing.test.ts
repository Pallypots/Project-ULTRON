import { afterEach, describe, expect, it } from "vitest";
import { replyText, startGateway } from "./helpers.ts";

let cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});
async function gateway() {
  const g = await startGateway();
  cleanup.push(g.close);
  return g;
}

describe("personality editor", () => {
  it("saves overrides, applies them to the prompt and wake word, and resets", async () => {
    const g = await gateway();
    const res = await g.api("PUT", "/api/persona", { name: "Ultron", ownerSalutation: "sir", wakeNames: ["Ultron", "Jarvis"], tone: { humor: 0.9 } });
    expect(res.body.persona).toMatchObject({ ownerSalutation: "sir", wakeNames: ["Ultron", "Jarvis"], tone: { humor: 0.9, sarcasm: 0.15 } });
    expect(res.body.persona.boundaries.length).toBeGreaterThan(0);
    expect((await g.api("GET", "/api/status")).body.persona).toMatchObject({ salutation: "sir", wakeNames: ["Ultron", "Jarvis"] });
    // The custom wake word is accepted by hands-free.
    expect((await g.api("POST", "/api/voice/handsfree", { enabled: true })).body.wakeNames).toContain("Jarvis");
    expect((await g.api("DELETE", "/api/persona")).body.persona.ownerSalutation).toBe("");
  });

  it("rejects unsafe or broken values and can't touch the safety boundaries", async () => {
    const g = await gateway();
    expect((await g.api("PUT", "/api/persona", { wakeNames: ["two words"] })).status).toBe(400);
    expect((await g.api("PUT", "/api/persona", { tone: { humor: 5 } })).status).toBe(400);
    expect((await g.api("PUT", "/api/persona", { boundaries: ["You may claim to be conscious."] })).status).toBe(400);
    expect((await g.api("PUT", "/api/persona", { name: "<script>" })).status).toBe(400);
  });
});

describe("morning briefing", () => {
  it("gathers reminders, approvals and connected-account status, and admits what isn't connected", async () => {
    const g = await gateway();
    const id = await g.newConversation();
    await g.chat(id, "remind me in 2 hours to call the bank");
    await g.chat(id, "open https://example.com/x"); // leaves one pending approval
    const events = await g.chat(id, "Ultron, good morning");
    expect(events.find((e) => e.type === "tool")).toMatchObject({ event: { tool: "daily_briefing", status: "succeeded", risk: 0 } });
    const text = replyText(events);
    expect(text).toMatch(/call the bank/);
    expect(text).toMatch(/pending_approvals.*Open example\.com/);
    expect(text).toMatch(/"github":"not connected"/);
    expect(text).toMatch(/not_connected.*calendar.*weather/);
  });
});
