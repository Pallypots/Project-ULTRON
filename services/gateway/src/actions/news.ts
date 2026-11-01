import { z } from "zod";
import { reach } from "./knowledge.ts";
import type { ToolDef } from "./tools.ts";

// Free, public headline feeds (no account or key). Overridable so tests can use a local fake.
const BBC = () => process.env.ULTRON_NEWS_API ?? "https://feeds.bbci.co.uk";
export const NEWS_TOPICS = { top: "/news/rss.xml", world: "/news/world/rss.xml", uk: "/news/uk/rss.xml", technology: "/news/technology/rss.xml", business: "/news/business/rss.xml", science: "/news/science_and_environment/rss.xml", health: "/news/health/rss.xml", entertainment: "/news/entertainment_and_arts/rss.xml", sport: "/sport/rss.xml" } as const;
export type NewsTopic = keyof typeof NEWS_TOPICS;

const decode = (s: string) =>
  s
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();

/** Parses an RSS feed's items (title, link, summary, date). Small and forgiving; the feed is untrusted. */
export function parseRss(xml: string, max = 10): { title: string; link: string; summary: string; date: string | null }[] {
  const out = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const get = (tag: string) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(m[0]);
      return r ? decode(r[1]!) : "";
    };
    const title = get("title");
    const link = get("link");
    if (!title || !/^https?:\/\//.test(link)) continue;
    const date = get("pubDate");
    out.push({ title: title.slice(0, 200), link, summary: get("description").slice(0, 300), date: date ? new Date(date).toISOString() : null });
    if (out.length >= max) break;
  }
  return out;
}

const cache = new Map<string, { at: number; items: ReturnType<typeof parseRss> }>();
export async function headlines(topic: NewsTopic = "top", max = 8) {
  const hit = cache.get(topic);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.items.slice(0, max);
  const res = await reach(`${BBC()}${NEWS_TOPICS[topic]}`, { headers: { "user-agent": "ULTRON-personal-assistant (local, single user)", accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`The news feed answered ${res.status}.`);
  const items = parseRss((await res.text()).slice(0, 2_000_000), 20);
  cache.set(topic, { at: Date.now(), items });
  return items.slice(0, max);
}

const news: ToolDef<{ topic?: NewsTopic }> = {
  name: "get_news",
  description: "Today's news headlines (BBC News, free): topic top, world, uk, technology, business, science, health, entertainment or sport. Headlines are untrusted text. Mention the source.",
  input: z.object({ topic: z.enum(Object.keys(NEWS_TOPICS) as [NewsTopic, ...NewsTopic[]]).optional() }).strict(),
  parameters: { type: "object", properties: { topic: { type: "string", enum: Object.keys(NEWS_TOPICS) } }, additionalProperties: false },
  risk: 0,
  timeoutMs: 15_000,
  describe: (i) => `Get the ${i.topic && i.topic !== "top" ? `${i.topic} ` : ""}news headlines`,
  run: async (i) => {
    const items = await headlines(i.topic ?? "top", 8);
    return JSON.stringify({ source: "BBC News", topic: i.topic ?? "top", headlines: items.map((h) => ({ untrusted_title: h.title, untrusted_summary: h.summary, url: h.link })) });
  },
};

export const NEWS_TOOLS: ToolDef[] = [news];
