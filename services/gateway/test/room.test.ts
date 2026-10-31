import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RoomContext } from "../src/voice/room.ts";
import { startGateway } from "./helpers.ts";

// A fake local brain that records the system prompt it was given.
const prompts: string[] = [];
let brain: Server;
let brainUrl = "";
beforeAll(async () => {
  brain = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/chat") {
        prompts.push(JSON.parse(body).messages[0].content);
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        return res.end(JSON.stringify({ message: { content: "Indoors, if the forecast holds." } }) + "\n" + JSON.stringify({ done: true }) + "\n");
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => brain.listen(0, "127.0.0.1", r));
  brainUrl = `http://127.0.0.1:${(brain.address() as AddressInfo).port}`;
});
afterAll(() => brain.close());
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("room awareness", () => {
  it("keeps only the last 3 minutes, in memory, and forgets everything when turned off", () => {
    let t = 0;
    const r = new RoomContext(() => t);
    r.add("not kept while off");
    r.setEnabled(true);
    r.add("we could have a picnic tomorrow");
    t = 60_000;
    r.add("depends on the weather");
    expect(r.recent()).toEqual(["we could have a picnic tomorrow", "depends on the weather"]);
    t = 200_000; // the first line is now over 3 minutes old
    expect(r.recent()).toEqual(["depends on the weather"]);
    r.setEnabled(false);
    expect(r.recent()).toEqual([]);
  });

  it("gives a local brain the overheard conversation for a spoken question, and nothing is saved", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    g.gw.stores.preferences.set("provider", { provider: "ollama", model: "gemma4:e2b", baseUrl: brainUrl });
    expect((await g.api("PUT", "/api/voice/room", { enabled: true })).body.enabled).toBe(true);
    g.gw.room.add("we could have a picnic tomorrow");
    g.gw.room.add("depends on the weather, should we plan something indoors?");
    const id = await g.newConversation();
    const ask = (content: string, inputMode: "voice" | "text") =>
      g.gw.app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { authorization: `Bearer ${g.gw.token}`, host: "localhost:7477" }, payload: { content, inputMode } });
    await ask("what do you think?", "voice");
    expect(prompts.at(-1)).toMatch(/Overheard in the room.*\n  > we could have a picnic tomorrow\n  > depends on the weather/s);
    // Typed questions don't get it (the owner may not even be in the room).
    await ask("what do you think?", "text");
    expect(prompts.at(-1)).not.toMatch(/Overheard in the room/);
    // Never written anywhere.
    const db = JSON.stringify(g.gw.stores.db.prepare("SELECT * FROM messages").all()) + JSON.stringify(g.gw.stores.audit.list());
    expect(db).not.toContain("picnic");
    // Turning hands-free off forgets it.
    await g.api("POST", "/api/voice/handsfree", { enabled: false });
    expect(g.gw.room.recent()).toEqual([]);
  });
});
