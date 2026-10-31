import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { loadPersona } from "@ultron/agent-core";
import { rapportFor } from "../src/chat.ts";
import { Summarizer } from "../src/summarizer.ts";
import { startGateway } from "./helpers.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
const gateway = async () => {
  const g = await startGateway();
  cleanup.push(g.close);
  return g;
};
const persona = () => loadPersona(new URL("../../../config/persona.json", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));

describe("ULTRON's notes on finished conversations", () => {
  it("summarizes quiet conversations once, again after new messages, and uses the notes when catching up", async () => {
    const g = await gateway();
    const a = await g.newConversation();
    await g.chat(a, "Planning the Oogie port release for December");
    await g.chat(a, "The audio crackle still needs fixing first");
    const short = await g.newConversation();
    await g.chat(short, "Quick question about pizza"); // only 2 messages: not worth a note
    let busy = false;
    const s = new Summarizer({ stores: g.gw.stores, secrets: { get: () => null } as never, persona, mockDelayMs: 0 }, () => busy, { idleMs: 0 });
    expect(await s.tick()).toBe(1);
    const conv = g.gw.stores.conversations.get(a)!;
    expect(conv.summary).toBe('The owner said: "Planning the Oogie port release for December", then "The audio crackle still needs fixing first".');
    expect(await s.tick()).toBe(0); // nothing new
    await g.chat(a, "Fixed the crackle!");
    expect(await s.tick()).toBe(1); // new messages since the note
    // Catch-up now uses the note, with when it happened.
    const now = await g.newConversation();
    expect(rapportFor(g.gw.stores, now).recentTopics.join(" | ")).toMatch(/^a moment ago: The owner said: "Planning the Oogie port release/);
    // Never while ULTRON is busy answering.
    await g.chat(a, "One more thing");
    busy = true;
    expect(await s.tick()).toBe(0);
  });

  it("steps aside when the owner starts talking (cancelled mid-note, retried later)", async () => {
    const hang = createServer(() => {});
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", r));
    try {
      const g = await gateway();
      const a = await g.newConversation();
      await g.chat(a, "first");
      await g.chat(a, "second");
      g.gw.stores.preferences.set("provider", { provider: "ollama", model: "gemma4:e2b", baseUrl: `http://127.0.0.1:${(hang.address() as AddressInfo).port}` });
      const s = new Summarizer({ stores: g.gw.stores, secrets: { get: () => null } as never, persona, mockDelayMs: 0 }, () => false, { idleMs: 0 });
      const pending = s.tick();
      await new Promise((r) => setTimeout(r, 100));
      s.cancel();
      expect(await pending).toBe(0);
      expect(g.gw.stores.conversations.get(a)!.summary).toBeNull();
    } finally {
      hang.closeAllConnections();
      hang.close();
    }
  });
});
