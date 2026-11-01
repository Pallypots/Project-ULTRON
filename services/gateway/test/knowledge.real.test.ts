// The knowledge tools against the REAL free services (Wikipedia, Open-Meteo) and a real web page.
// Needs internet, so it only runs when ULTRON_TEST_WEB=1 (CI sets it).
import { describe, expect, it } from "vitest";
import { fetchPage, weatherFor } from "../src/actions/knowledge.ts";
import { toolByName } from "../src/actions/tools.ts";
import { ciNote } from "./helpers.ts";

const enabled = process.env.ULTRON_TEST_WEB === "1";
const note = (title: string, msg: string) => ciNote(title, msg);

describe.skipIf(!enabled)("knowledge tools against the real services", () => {
  it("looks up Wikipedia", async () => {
    const out = JSON.parse(await toolByName("lookup_wikipedia")!.run({ topic: "Ada Lovelace" }, {} as never));
    note("Real Wikipedia lookup", `${out.title}: ${String(out.untrusted_summary).slice(0, 140)}`);
    expect(out.found).toBe(true);
    expect(out.untrusted_summary).toMatch(/mathematician|Babbage/i);
  }, 30_000);

  it("gets the weather", async () => {
    const w = await weatherFor("Boston", true);
    note("Real weather", JSON.stringify({ place: w.place, now: w.now }));
    expect(w.found).toBe(true);
    expect(w.place).toMatch(/Boston/);
    expect(w.now?.temperature).toMatch(/°F$/);
    expect(w.next_days).toHaveLength(3);
  }, 30_000);

  it("gets the chance of rain for the next hours (rain heads-up)", async () => {
    const { rainSoon } = await import("../src/actions/knowledge.ts");
    const r = await rainSoon("London");
    expect(r?.hours.length).toBeGreaterThanOrEqual(2);
    expect(typeof r?.hours[0]?.chance).toBe("number");
    ciNote("Rain heads-up", `London: ${r!.rainingNow ? "raining now; " : ""}${r!.hours.map((h) => `${h.at.slice(11)} ${h.chance}%`).join(", ")}`);
  });

  it("reads a public web page", async () => {
    const page = await fetchPage("https://example.com/");
    note("Real web page", `${page.title}: ${page.text.slice(0, 100)}`);
    expect(page.title).toMatch(/Example Domain/);
  }, 30_000);

  it("converts currency, defines a word and tells the time in Tokyo", async () => {
    const { toolByName } = await import("../src/actions/tools.ts");
    const fx = JSON.parse(await toolByName("convert_currency")!.run({ amount: 100, from: "USD", to: "EUR" }, {} as never));
    const def = JSON.parse(await toolByName("define_word")!.run({ word: "serendipity" }, {} as never));
    const tokyo = JSON.parse(await toolByName("world_time")!.run({ place: "Tokyo" }, {} as never));
    note("Real everyday services", `100 USD = ${fx.result} EUR (${fx.date}) | serendipity: ${def.meanings?.[0]?.definitions?.[0]?.definition?.slice(0, 80)} | Tokyo: ${tokyo.time} (${tokyo.hours_ahead_of_you} h ahead)`);
    expect(fx.result).toBeGreaterThan(50);
    expect(def.found).toBe(true);
    expect(tokyo.time_zone).toBe("Asia/Tokyo");
  }, 30_000);

  it("finds Wikipedia articles from a whole question (for research)", async () => {
    const { wikiArticles } = await import("../src/actions/knowledge.ts");
    const found = await wikiArticles("how solid-state batteries work", 2);
    expect(found.map((a) => a.title).join(" ")).toMatch(/battery/i);
    note("Real Wikipedia full-text search", found.map((a) => `${a.title} (${a.text.length} chars)`).join(", "));
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.text.length).toBeGreaterThan(200);
  }, 30_000);
});

