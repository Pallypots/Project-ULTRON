import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
const { loadVoicePrefs, saveVoicePrefs } = await import("../src/voice/prefs.ts");

describe("interrupt by voice is on by default (2.6)", () => {
  beforeEach(() => store.clear());
  it("is on for a new install and for older saved settings that had it off", () => {
    expect(loadVoicePrefs().bargeIn).toBe(true);
    store.set("ultron.voice", JSON.stringify({ bargeIn: false, micId: "usb" }));
    const p = loadVoicePrefs();
    expect(p.bargeIn).toBe(true);
    expect(p.micId).toBe("usb"); // everything else kept
  });
  it("negative control: turning it off after the upgrade sticks", () => {
    saveVoicePrefs({ ...loadVoicePrefs(), bargeIn: false });
    expect(loadVoicePrefs().bargeIn).toBe(false);
  });
});
