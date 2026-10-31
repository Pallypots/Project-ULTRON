import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretStore } from "../src/secrets.ts";

const KEY = "sk-ant-test-SUPERSECRET-0123456789";
const dir = () => mkdtempSync(join(tmpdir(), "ultron-secrets-"));

describe("secret storage", () => {
  it("round-trips and never writes the key in plain text", () => {
    const d = dir();
    const s = new SecretStore(d);
    s.set("ANTHROPIC_API_KEY", KEY);
    const raw = readFileSync(join(d, "secrets.json"), "utf8");
    expect(raw).not.toContain(KEY);
    expect(JSON.parse(raw)).toMatchObject({ v: 2, protection: process.platform === "win32" ? "dpapi" : "file-permissions" });
    expect(new SecretStore(d).get("ANTHROPIC_API_KEY")).toBe(KEY);
    if (process.env.GITHUB_ACTIONS && process.platform === "win32") console.log(`::notice title=Secret storage (${process.platform})::protection=${JSON.parse(raw).protection}; plaintext key present in file: ${raw.includes(KEY)}`);
  });

  it("upgrades old plain-JSON files in place", () => {
    const d = dir();
    writeFileSync(join(d, "secrets.json"), JSON.stringify({ OPENAI_API_KEY: KEY }));
    expect(new SecretStore(d).get("OPENAI_API_KEY")).toBe(KEY);
    expect(readFileSync(join(d, "secrets.json"), "utf8")).not.toContain(KEY);
  });

  it("never crashes on an unreadable file: genuine decryption failures are set aside, temporary ones keep the file locked", () => {
    const d = dir();
    const original = JSON.stringify({ v: 2, protection: "dpapi", data: "bm90LXJlYWxseS1lbmNyeXB0ZWQ=" });
    writeFileSync(join(d, "secrets.json"), original);
    const s = new SecretStore(d, "file-permissions");
    expect(s.get("ANTHROPIC_API_KEY")).toBeUndefined();
    if (process.platform === "win32") {
      // Real DPAPI says the data is invalid → moved aside with an explanation.
      expect(s.problem).toMatch(/couldn't be decrypted/);
      expect(readdirSync(d).some((f) => f.startsWith("secrets.json.unreadable-"))).toBe(true);
    } else {
      // No PowerShell here = "Windows busy/unavailable" path: file untouched, writes refused so nothing is overwritten.
      expect(s.problem).toMatch(/couldn't be unlocked just now/);
      expect(readFileSync(join(d, "secrets.json"), "utf8")).toBe(original);
      expect(() => s.set("OPENAI_API_KEY", "sk-new-1234567890")).toThrow(/temporarily locked/);
    }
  });

  it("scrubs secrets supplied by environment variables too", () => {
    process.env.ULTRON_GITHUB_TOKEN = "github_pat_ENVONLY_abcdefghijklmnop";
    expect(new SecretStore(dir()).values()).toContain("github_pat_ENVONLY_abcdefghijklmnop");
    delete process.env.ULTRON_GITHUB_TOKEN;
  });
});
