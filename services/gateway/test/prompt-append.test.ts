import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGateway } from "./helpers.ts";

// A fake local brain that records every request.
const bodies: { messages: { role: string; content: string }[] }[] = [];
let brain: Server;
let url = "";
beforeAll(async () => {
  brain = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (req.url !== "/api/chat") return res.writeHead(404).end();
      bodies.push(JSON.parse(b));
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: "Good, thanks. You?" } }) + "\n" + JSON.stringify({ done: true }) + "\n");
    });
  });
  await new Promise<void>((r) => brain.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(brain.address() as AddressInfo).port}`;
});
afterAll(() => brain.close());

describe("a local brain can reuse what it already read", () => {
  it("each request only adds to the end of the last one; only the newest message gets fresh context", async () => {
    const g = await startGateway();
    try {
      g.gw.stores.preferences.set("provider", { provider: "ollama", model: "gemma4:e2b", baseUrl: url });
      const id = await g.newConversation();
      for (const content of ["Hey Ultron, how's it going?", "I'm thinking of learning the guitar. What do you reckon?"])
        await g.gw.app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { authorization: `Bearer ${g.gw.token}`, host: "localhost:7477" }, payload: { content, inputMode: "voice" } });
      const [one, two] = bodies.slice(-2).map((b) => b.messages);
      // Positive: turn 2 starts with exactly everything turn 1 sent (Gemma can't reuse its reading otherwise).
      expect(two!.slice(0, one!.length)).toEqual(one);
      expect(two!.length).toBe(one!.length + 2);
      // Negative controls: the earlier message keeps its old context, and the new one has its own, not a copy.
      expect(one!.at(-1)!.content).toMatch(/first conversation/);
      expect(two!.at(-1)!.content).not.toMatch(/first conversation/);
      expect(two!.at(-1)!.content).toMatch(/\[Context[\s\S]*learning the guitar/);
    } finally {
      await g.close();
    }
  });
});
