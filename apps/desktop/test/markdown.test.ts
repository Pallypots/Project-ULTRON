import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../src/markdown.ts";

describe("reply formatting (safe Markdown)", () => {
  it("reads headings, lists, bold, italics, code and links", () => {
    const blocks = parseMarkdown("## Summary\nSolid-state batteries are **safer** and *denser*.\n\n- Uses a `solid` electrolyte [1]\n- Still costly\n\n1. Check prices\n2. Read [the paper](https://example.com/p)");
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul", "ol"]);
    expect(blocks[1]).toEqual({ t: "p", c: [{ t: "text", v: "Solid-state batteries are " }, { t: "b", c: [{ t: "text", v: "safer" }] }, { t: "text", v: " and " }, { t: "i", c: [{ t: "text", v: "denser" }] }, { t: "text", v: "." }] });
    expect(blocks[2]).toMatchObject({ t: "ul", items: [[{ t: "text", v: "Uses a " }, { t: "code", v: "solid" }, { t: "text", v: " electrolyte [1]" }], [{ t: "text", v: "Still costly" }]] });
    expect(blocks[3]).toMatchObject({ t: "ol", start: 1, items: [[{ t: "text", v: "Check prices" }], [{ t: "text", v: "Read " }, { t: "a", href: "https://example.com/p" }]] });
  });

  it("never makes unsafe links and keeps HTML as plain text", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ t: "text", v: "[click](javascript:alert(1))" }]);
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
    expect(parseInline("see https://example.com/a.")).toEqual([{ t: "text", v: "see " }, { t: "a", href: "https://example.com/a", c: [{ t: "text", v: "https://example.com/a" }] }, { t: "text", v: "." }]);
  });

  it("leaves everyday text alone", () => {
    expect(parseInline("2 * 3 * 4 = 24")).toEqual([{ t: "text", v: "2 * 3 * 4 = 24" }]);
    expect(parseInline("snake_case_name")).toEqual([{ t: "text", v: "snake_case_name" }]);
    expect(parseMarkdown("```\n**not bold**\n```")).toEqual([{ t: "pre", v: "**not bold**" }]);
    expect(parseMarkdown("line one\nline two")).toEqual([{ t: "p", c: [{ t: "text", v: "line one\nline two" }] }]);
  });
});
