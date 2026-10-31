import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { wantsScreen } from "../src/system/screen.ts";
import { replyText, startGateway, tmpDataDir } from "./helpers.ts";

// A fake local brain: reports whether it has vision, and records what it was sent.
let vision = true;
const chats: any[] = [];
let brain: Server;
let brainUrl = "";
beforeAll(async () => {
  brain = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/show") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ capabilities: vision ? ["completion", "vision"] : ["completion", "tools"] }));
      }
      if (req.url === "/api/chat") {
        chats.push(JSON.parse(body));
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        return res.end(JSON.stringify({ message: { content: "That's a red error dialog saying the file is locked." } }) + "\n" + JSON.stringify({ done: true }) + "\n");
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => brain.listen(0, "127.0.0.1", r));
  brainUrl = `http://127.0.0.1:${(brain.address() as AddressInfo).port}`;
  const shot = join(tmpDataDir(), "screen.jpg");
  writeFileSync(shot, Buffer.alloc(30_000, 7)); // stand-in for a real screenshot
  process.env.ULTRON_FAKE_SCREENSHOT = shot;
});
afterAll(() => {
  brain.close();
  delete process.env.ULTRON_FAKE_SCREENSHOT;
});
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("looking at the screen", () => {
  it("recognises when the owner asks", () => {
    for (const t of ["look at my screen", "Ultron, what's on my screen right now?", "can you see my screen", "read this error on the screen for me", "what am I looking at?"]) expect(wantsScreen(t), t).toBe(true);
    for (const t of ["my screen is cracked, where can I fix it?", "screen time limits for kids", "look at this recipe"]) expect(wantsScreen(t), t).toBe(false);
  });

  it("shares one screenshot with the brain for that message only, shows it in Activity, and never stores the image", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const id = await g.newConversation();
    const events = await g.chat(id, "look at my screen, what's this error?");
    const chip = events.find((e) => e.type === "tool") as any;
    expect(chip.event).toMatchObject({ tool: "look_at_screen", status: "succeeded", summary: "Showed your screen to the local brain (stays on this PC, not saved)" });
    expect(replyText(events)).toMatch(/I was shown 1 image \(29 KB\)/);
    // Not in the conversation history, the action log or anywhere in the database.
    const dump = JSON.stringify(g.gw.stores.db.prepare("SELECT * FROM messages").all()) + JSON.stringify(g.gw.stores.db.prepare("SELECT * FROM tool_executions").all());
    expect(dump).not.toContain(Buffer.alloc(30, 7).toString("base64").slice(0, 30));
    // A later message doesn't resend it.
    expect(replyText(await g.chat(id, "thanks"))).not.toMatch(/image/);
    expect((await g.api("GET", "/api/activity")).body.events.some((e: { action: string }) => e.action === "screen.shared")).toBe(true);
  });

  it("sends the picture to a local brain that can see, and explains when it can't", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    g.gw.stores.preferences.set("provider", { provider: "ollama", model: "gemma3:4b", baseUrl: brainUrl });
    const id = await g.newConversation();
    vision = false;
    expect(replyText(await g.chat(id, "what's on my screen?"))).toMatch(/can't see images.*gemma3:4b or qwen2\.5vl:7b/);
    expect(chats).toHaveLength(0); // nothing was captured or sent
    vision = true;
    expect(replyText(await g.chat(id, "what's on my screen?"))).toMatch(/red error dialog/);
    const sent = chats.at(-1).messages.at(-1);
    expect(sent.role).toBe("user");
    expect(sent.images).toHaveLength(1);
    expect(sent.images[0].length).toBeGreaterThan(30_000);
  });
});

describe.skipIf(process.platform !== "win32")("real Windows screenshot", () => {
  it("captures the primary screen as a JPEG (informational: CI machines may have no visible desktop)", async () => {
    const { captureScreen } = await import("../src/system/screen.ts");
    const { ciNote } = await import("./helpers.ts");
    const saved = process.env.ULTRON_FAKE_SCREENSHOT;
    delete process.env.ULTRON_FAKE_SCREENSHOT;
    try {
      const b64 = await captureScreen(tmpDataDir());
      ciNote("Windows screenshot", `captured ${Math.round((b64.length * 3) / 4 / 1024)} KB, JPEG=${b64.startsWith("/9j/")}`);
      expect(b64.startsWith("/9j/")).toBe(true);
    } catch (err) {
      ciNote("Windows screenshot", `not available here: ${(err as Error).message}`);
    } finally {
      process.env.ULTRON_FAKE_SCREENSHOT = saved;
    }
  }, 60_000);
});
