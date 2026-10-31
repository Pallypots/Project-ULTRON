import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { detectQuickCommand } from "@ultron/agent-core";
import { convertUnits, parseConversion } from "../src/actions/units.ts";
import { conversionFor } from "../src/chat.ts";
import { replyText, startGateway } from "./helpers.ts";

let server: Server;
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const json = (v: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (url.pathname === "/fx/latest") return json({ base: url.searchParams.get("base"), date: "2026-10-30", rates: { [url.searchParams.get("symbols")!]: 0.92 } });
    if (url.pathname === "/dict/serendipity")
      return json([{ word: "serendipity", phonetic: "/ˌsɛɹ.ənˈdɪp.ɪ.ti/", meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "A combination of events which have come together by chance to make a surprisingly good result.", example: "Meeting her there was pure serendipity." }] }] }]);
    if (url.pathname.startsWith("/dict/")) return json({ title: "No Definitions Found" }, 404);
    // Wiktionary: knows "ephemeral" (HTML in definitions), is down for "serendipity" (so the fallback is used), 404 otherwise.
    if (url.pathname === "/wikt/ephemeral") return json({ en: [{ partOfSpeech: "Adjective", definitions: [{ definition: "Lasting for a <b>short</b> period of time.", examples: ["an <i>ephemeral</i> fashion"] }] }] });
    if (url.pathname === "/wikt/serendipity") return json({}, 503);
    if (url.pathname.startsWith("/wikt/")) return json({}, 404);
    if (url.pathname === "/v1/search") return json({ results: url.searchParams.get("name") === "Atlantis" ? [] : [{ name: "Tokyo", country: "Japan", timezone: "Asia/Tokyo" }] });
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ULTRON_FX_API = `${base}/fx`;
  process.env.ULTRON_DICT_API = `${base}/dict`;
  process.env.ULTRON_WIKTIONARY_API = `${base}/wikt`;
  process.env.ULTRON_GEOCODE_API = base;
});
afterAll(() => {
  server.close();
  for (const k of ["ULTRON_FX_API", "ULTRON_DICT_API", "ULTRON_WIKTIONARY_API", "ULTRON_GEOCODE_API"]) delete process.env[k];
});
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
const gateway = async () => {
  const g = await startGateway();
  cleanup.push(g.close);
  return g;
};

describe("unit conversion", () => {
  it("is exact, handles temperature offsets, and refuses mismatched units", () => {
    expect(convertUnits(5, "miles", "km").value).toBeCloseTo(8.04672, 5);
    expect(convertUnits(72, "F", "C").value).toBeCloseTo(22.2222, 3);
    expect(convertUnits(100, "celsius", "fahrenheit").value).toBe(212);
    expect(convertUnits(1, "cup", "ml").value).toBeCloseTo(236.588, 2);
    expect(convertUnits(180, "lbs", "kg").value).toBeCloseTo(81.6466, 3);
    expect(() => convertUnits(5, "miles", "kg")).toThrow(/Can't convert length/);
    expect(() => convertUnits(5, "smoots", "m")).toThrow(/don't know the unit "smoots"/);
    expect(parseConversion("how many cups in a litre")).toEqual({ value: 1, from: "litre", to: "cups" });
  });

  it("answers instantly by chat, and leaves unknown units to the brain", async () => {
    const g = await gateway();
    const id = await g.newConversation();
    expect(replyText(await g.chat(id, "convert 5 miles to km"))).toBe("5 miles = 8.0467 km");
    expect(replyText(await g.chat(id, "what's 72 F in C?"))).toBe("72 F = 22.2222 C");
    expect(replyText(await g.chat(id, "how many cups in a litre?"))).toBe("1 litre = 4.2268 cups");
    expect(conversionFor("5 smoots to meters")).toBeNull();
    expect(replyText(await g.chat(id, "5 smoots to meters"))).toMatch(/Offline mock mode/);
  });
});

describe("currency, definitions and world time", () => {
  it("converts money with today's rate", async () => {
    const g = await gateway();
    expect(replyText(await g.chat(await g.newConversation(), "how much is $50 in euros?"))).toBe("50 USD = 46.00 EUR (rate 0.92, 2026-10-30, European Central Bank)");
    expect(replyText(await g.chat(await g.newConversation(), "100 pounds to yen"))).toMatch(/^100 GBP = 92\.00 JPY/);
    // "100 pounds to kg" is weight, not money.
    expect(replyText(await g.chat(await g.newConversation(), "100 pounds to kg"))).toBe("100 pounds = 45.3592 kg");
  });

  it("defines words and tells the time anywhere", async () => {
    const g = await gateway();
    const id = await g.newConversation();
    expect(replyText(await g.chat(id, "define serendipity"))).toMatch(/^serendipity \/ˌsɛɹ.ənˈdɪp.ɪ.ti\/\n• \(noun\) A combination of events.*E\.g\. "Meeting her there was pure serendipity\."/);
    expect(replyText(await g.chat(id, "what does flibbertigibbetx mean?"))).toMatch(/couldn't find "flibbertigibbetx"/);
    expect(replyText(await g.chat(id, "define ephemeral"))).toBe('ephemeral\n• (adjective) Lasting for a short period of time. E.g. "an ephemeral fashion"');
    expect(replyText(await g.chat(id, "what time is it in Tokyo?"))).toMatch(/^It's .+ in Tokyo, Japan \((same time as you|[\d.]+ hours? (ahead of|behind) you)\)\.$/);
    expect(replyText(await g.chat(id, "what time is it in Atlantis"))).toMatch(/couldn't find a place called "Atlantis"/);
  });

  it("parses the everyday phrasings", () => {
    expect(detectQuickCommand("what does ephemeral mean?")).toEqual({ type: "define", word: "ephemeral" });
    expect(detectQuickCommand("Ultron, what time is it in New York")).toEqual({ type: "world_time", place: "New York" });
    expect(detectQuickCommand("convert 30 cm to inches")).toEqual({ type: "convert", text: "convert 30 cm to inches" });
    expect(detectQuickCommand("what time is it")).toBeNull();
  });
});
