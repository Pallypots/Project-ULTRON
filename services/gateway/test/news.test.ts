import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { detectQuickCommand } from "@ultron/agent-core";
import { parseRss } from "../src/actions/news.ts";
import { replyText, startGateway } from "./helpers.ts";

const RSS = `<?xml version="1.0"?><rss><channel><title>BBC News</title>
<item><title><![CDATA[Scientists unveil solid-state battery breakthrough]]></title><description><![CDATA[A new cell charges in minutes.]]></description><link>https://www.bbc.co.uk/news/1</link><pubDate>Sun, 01 Nov 2026 06:00:00 GMT</pubDate></item>
<item><title>Storm &amp; floods hit coast</title><link>https://www.bbc.co.uk/news/2</link></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;
let server: Server;
const paths: string[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    paths.push(req.url!);
    res.writeHead(200, { "content-type": "application/rss+xml" });
    res.end(RSS);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.ULTRON_NEWS_API = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  delete process.env.ULTRON_NEWS_API;
  server.close();
});
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("news headlines (free BBC feeds)", () => {
  it("parses RSS safely", () => {
    const items = parseRss(RSS);
    expect(items.map((i) => i.title)).toEqual(["Scientists unveil solid-state battery breakthrough", "Storm & floods hit coast"]);
    expect(items[0]).toMatchObject({ summary: "A new cell charges in minutes.", date: "2026-11-01T06:00:00.000Z" });
    expect(detectQuickCommand("what's the tech news?")).toEqual({ type: "news", topic: "technology" });
  });

  it("answers 'what's the news?' instantly and puts headlines in the briefing", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const id = await g.newConversation();
    expect(replyText(await g.chat(id, "what's the news?"))).toBe("Top stories (BBC News):\n• Scientists unveil solid-state battery breakthrough\n• Storm & floods hit coast\nWant more on any of them?");
    expect(replyText(await g.chat(id, "tech news"))).toMatch(/^Technology news \(BBC News\)/);
    expect(paths).toContain("/news/technology/rss.xml");
    expect(replyText(await g.chat(id, "mock-tool daily_briefing {}"))).toContain("untrusted_top_news_bbc");
  });
});
