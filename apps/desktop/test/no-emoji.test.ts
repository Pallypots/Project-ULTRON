import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The interface uses line icons, never emoji (they look different on every PC and cheapen it).
const EMOJI = /(?![©®™])[\p{Extended_Pictographic}■-◿✀-➿]/u;
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.(tsx?|css|html)$/.test(f) ? [join(dir, f)] : []));

describe("no emoji in ULTRON's interface", () => {
  it("finds none in the app's source", () => {
    const root = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
    const hits = files(root).flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((l, i) => [l, i] as const)
        .filter(([l]) => EMOJI.test(l.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "")))
        .map(([l, i]) => `${f.slice(root.length)}:${i + 1}: ${l.trim().slice(0, 80)}`),
    );
    expect(hits).toEqual([]);
  });
  it("the check itself catches emoji (negative control)", () => {
    expect(EMOJI.test("🎙 Talk")).toBe(true);
    expect(EMOJI.test("■ Stop")).toBe(true);
    expect(EMOJI.test("Settings → Voice · 21°C")).toBe(false);
  });
});
