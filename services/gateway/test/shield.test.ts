import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { replyText, startGateway } from "./helpers.ts";

// A fake OpenAI-compatible cloud service that records exactly what it receives.
const received: string[] = [];
let cloud: Server;
let cloudUrl = "";
beforeAll(async () => {
  cloud = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: "Noted." }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((r) => cloud.listen(0, "127.0.0.1", r));
  cloudUrl = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}/v1`;
});
afterAll(() => cloud.close());
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("privacy shield", () => {
  it("never sends card numbers or passwords to a cloud brain, says so, and keeps the original in ULTRON", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    await g.api("PUT", "/api/settings/provider", { provider: "openai", model: "gpt-test", baseUrl: cloudUrl, apiKey: "sk-test-1234567890abcdef" });
    const id = await g.newConversation();
    const events = await g.chat(id, "my card is 4111 1111 1111 1111 and my password: hunter2, what should I do if it leaks?");
    expect(replyText(events)).toMatch(/Noted\./);
    const sent = received.join("\n");
    expect(sent).not.toContain("4111 1111 1111 1111");
    expect(sent).not.toContain("hunter2");
    expect(sent).toContain("[card number hidden]");
    expect(events.find((e) => e.type === "tool")).toMatchObject({ event: { tool: "privacy_shield", summary: expect.stringMatching(/^Hid 2 sensitive items/) } });
    // ULTRON's own copy is untouched (it's the owner's conversation, on their PC).
    const stored = (await g.api("GET", `/api/conversations/${id}`)).body.messages[0].content;
    expect(stored).toContain("4111 1111 1111 1111");
  });
});
