import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { detectQuickCommand } from "@ultron/agent-core";
import { replyText, startGateway } from "./helpers.ts";

// A shop page whose content the test changes.
let page = "<html><body><h1>Switch 2</h1><p>Out of stock. Updated 10:41</p></body></html>";
let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ULTRON_ALLOW_PRIVATE_FETCH = "1";
});
afterAll(() => {
  server.close();
  delete process.env.ULTRON_ALLOW_PRIVATE_FETCH;
});
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("watching pages", () => {
  it("parses watch requests", () => {
    expect(detectQuickCommand("watch example.com/deal")).toEqual({ type: "watch", url: "https://example.com/deal", lookFor: null });
    expect(detectQuickCommand("let me know when shop.example.com/switch says in stock")).toEqual({ type: "watch", url: "https://shop.example.com/switch", lookFor: "in stock" });
    expect(detectQuickCommand("tell me when example.com changes")).toEqual({ type: "watch", url: "https://example.com", lookFor: null });
    expect(detectQuickCommand("tell me when dinner is ready")).toBeNull();
  });

  it("waits for wanted text, ignores clock-only changes, notifies once and stops", async () => {
    page = "<html><body><h1>Switch 2</h1><p>Out of stock. Updated 10:41</p></body></html>";
    const g = await startGateway();
    cleanup.push(g.close);
    const seen: any[] = [];
    // The service's event bus is private; the test listens to it directly.
    (g.gw.watchers as unknown as { bus: { subscribe(f: (e: unknown) => void): void } }).bus.subscribe((e: any) => seen.push(e));
    const id = await g.newConversation();
    const r = replyText(await g.chat(id, `let me know when ${base}/switch says in stock`));
    expect(r).toMatch(/tell you when it says "in stock"/);
    const w = g.gw.stores.watchers.active()[0]!;
    const due = async () => {
      g.gw.stores.db.prepare("UPDATE watchers SET last_checked_at = NULL").run();
      return g.gw.watchers.tick();
    };
    expect(await due()).toBe(0); // first look: just records the page
    page = page.replace("10:41", "10:58"); // only the clock changed
    expect(await due()).toBe(0);
    page = "<html><body><h1>Switch 2</h1><p>In stock! Updated 11:02</p></body></html>";
    expect(await due()).toBe(1);
    expect(seen.at(-1)).toMatchObject({ type: "checkin", kind: "watch", body: expect.stringMatching(/"in stock" is now on 127\.0\.0\.1/) });
    expect(g.gw.stores.watchers.get(w.id)!.stoppedAt).not.toBeNull(); // done
  });

  it("reports any change for a plain watch, and can be listed and stopped", async () => {
    page = "<p>Price: $499</p>";
    const g = await startGateway();
    cleanup.push(g.close);
    const id = await g.newConversation();
    expect(replyText(await g.chat(id, `watch ${base}/price`))).toMatch(/tell you when it changes/);
    const due = async () => {
      g.gw.stores.db.prepare("UPDATE watchers SET last_checked_at = NULL").run();
      return g.gw.watchers.tick();
    };
    await due();
    expect(await due()).toBe(0);
    page = "<p>Price: $449</p>";
    expect(await due()).toBe(1);
    expect((await g.api("GET", "/api/watchers")).body.watchers).toHaveLength(1);
    expect(replyText(await g.chat(id, 'mock-tool stop_watching {"which":"127.0.0.1"}'))).toMatch(/"stopped"/);
    expect((await g.api("GET", "/api/watchers")).body.watchers).toHaveLength(0);
  });
});
