import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Shortcuts } from "../src/system/shortcuts.ts";

describe.skipIf(process.platform !== "win32")("Windows shortcuts (real Windows only)", () => {
  it("creates and removes the start-at-sign-in and desktop shortcuts", async () => {
    process.env.ULTRON_STARTUP_DIR = mkdtempSync(join(tmpdir(), "startup-"));
    process.env.ULTRON_DESKTOP_DIR = mkdtempSync(join(tmpdir(), "desktop-"));
    const s = new Shortcuts();
    expect(await s.state()).toEqual({ supported: true, startAtLogin: false, desktopShortcut: false });
    expect((await s.setStartAtLogin(true)).startAtLogin).toBe(true);
    expect(existsSync(join(process.env.ULTRON_STARTUP_DIR, "ULTRON.lnk"))).toBe(true);
    expect((await s.createDesktopShortcut()).desktopShortcut).toBe(true);
    expect((await s.setStartAtLogin(false)).startAtLogin).toBe(false);
    console.log(`::notice title=Windows shortcuts::start-at-sign-in and desktop shortcuts created and removed`);
  }, 60_000);
});

describe.skipIf(process.platform === "win32")("shortcuts elsewhere", () => {
  it("reports unsupported instead of failing", async () => {
    expect(await new Shortcuts().state()).toEqual({ supported: false, startAtLogin: false, desktopShortcut: false });
    await expect(new Shortcuts().setStartAtLogin(true)).rejects.toThrow(/only available on Windows/);
  });
});
