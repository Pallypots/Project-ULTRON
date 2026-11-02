import { describe, expect, it } from "vitest";
import { startGateway } from "./helpers.ts";

// The app asks for /api/status every 5 s and the Home HUD every 3 s. With a year of use (thousands of conversations
// and memories) those must stay cheap: they run on the same thread that streams replies.
describe("status and HUD stay cheap with a big history (3.7)", () => {
  it("answers in a few milliseconds with 2,000 conversations and 1,500 memories (heavier slowed other tests on Windows CI)", async () => {
    const g = await startGateway();
    try {
      const db = g.gw.stores.db;
      db.exec("BEGIN");
      for (let i = 0; i < 2000; i++) g.gw.stores.conversations.create(`Conversation ${i}`);
      db.exec("COMMIT");
      for (let i = 0; i < 1500; i++) g.gw.stores.memories.create({ content: `Fact number ${i} about the owner's life and preferences, written out at some length.`, kind: "fact", source: "owner" } as never);
      const time = async (url: string) => {
        await g.api("GET", url);
        const t = performance.now();
        for (let i = 0; i < 10; i++) await g.api("GET", url);
        return (performance.now() - t) / 10;
      };
      const status = await time("/api/status");
      const hud = await time("/api/hud");
      const st = (await g.api("GET", "/api/status")).body;
      console.log(`[status-load] /api/status ${status.toFixed(1)} ms, /api/hud ${hud.toFixed(1)} ms`);
      expect(st.counts).toEqual({ conversations: 2000, memories: 1500 }); // still right
      expect(status).toBeLessThan(15);
      expect(hud).toBeLessThan(40);
    } finally {
      await g.close();
    }
  }, 120_000);
});

describe("Settings → Performance reports how responsive the service was", () => {
  it("sees a deliberate 300 ms freeze, and nothing like it when idle", async () => {
    const g = await startGateway();
    try {
      await g.api("GET", "/api/perf"); // start a fresh window
      await new Promise((r) => setTimeout(r, 300));
      const idle = (await g.api("GET", "/api/perf")).body.responsiveness;
      expect(idle.worstMs).toBeLessThan(150);
      const until = Date.now() + 300;
      while (Date.now() < until); // block the thread, like heavy work on it would
      await new Promise((r) => setTimeout(r, 50));
      const frozen = (await g.api("GET", "/api/perf")).body.responsiveness;
      expect(frozen.worstMs).toBeGreaterThanOrEqual(250);
    } finally {
      await g.close();
    }
  });
});
