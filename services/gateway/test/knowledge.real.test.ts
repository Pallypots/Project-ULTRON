// The knowledge tools against the REAL free services (Wikipedia, Open-Meteo) and a real web page.
// Needs internet, so it only runs when ULTRON_TEST_WEB=1 (CI sets it).
import { describe, expect, it } from "vitest";
import { fetchPage, weatherFor } from "../src/actions/knowledge.ts";
import { toolByName } from "../src/actions/tools.ts";

const enabled = process.env.ULTRON_TEST_WEB === "1";
const note = (title: string, msg: string) => {
  console.log(`[web] ${title}: ${msg}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=${title} (${process.platform})::${msg}`);
};

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

  it("reads a public web page", async () => {
    const page = await fetchPage("https://example.com/");
    note("Real web page", `${page.title}: ${page.text.slice(0, 100)}`);
    expect(page.title).toMatch(/Example Domain/);
  }, 30_000);
});
