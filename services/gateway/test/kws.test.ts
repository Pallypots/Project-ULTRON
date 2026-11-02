import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { decodeWav } from "@ultron/audio";
import { WakeSpotter } from "../src/voice/kws.ts";

const wav = (name: string) => decodeWav(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).samples;
const spotter = new WakeSpotter();
afterAll(() => spotter.host.stop());

describe("wake-word detector (2.1)", () => {
  it("turns wake names into the model's word pieces", () => {
    expect(spotter.keywords(["Ultron"])).toEqual(["▁ UL T RO N :2.0 #0.2 @ULTRON"]);
    expect(spotter.keywords(["Hey Jarvis", "Friday!"])).toEqual(["▁HE Y ▁JA R VI S :2.0 #0.2 @HEY_JARVIS", "▁F RI DAY :2.0 #0.2 @FRIDAY"]);
    expect(spotter.keywords(["ウルトロン", ""])).toEqual([]); // nothing it can spell: falls back to full recognition
  });

  it("positive control: hears a phrase that's in the recording; negative: no 'Ultron' in speech without it", async () => {
    const lightUp = wav("kws/light-up.wav"); // "...the yellow lamps would light up here and there..."
    const t = Date.now();
    expect((await spotter.spot(lightUp, ["light up"]))?.hit).toBe(true);
    expect((await spotter.spot(lightUp, ["Ultron"]))?.hit).toBe(false);
    expect((await spotter.spot(wav("jfk.wav"), ["Ultron"]))?.hit).toBe(false);
    const quick = Date.now();
    await spotter.spot(wav("jfk.wav"), ["Ultron"]);
    console.log(`[kws] 3 checks incl. load ${quick - t} ms; an 11 s phrase checked in ${Date.now() - quick} ms`);
    expect(spotter.counts).toMatchObject({ checked: 4, spotted: 1 });
  }, 60_000);
});

describe("the detector proves itself on the owner's voice before it drops anything", async () => {
  const { WakeTrial, TRIAL_NEEDED } = await import("../src/voice/kws.ts");
  const fresh = () => {
    let saved: any = null;
    return new WakeTrial(() => saved, (s) => (saved = s));
  };
  it("is trusted only after catching the name at least 8 times, 90%+ of the time", () => {
    const t = fresh();
    expect(t.trusted(["Ultron"])).toBe(false);
    for (let i = 0; i < TRIAL_NEEDED - 1; i++) t.record(["Ultron"], true, true);
    expect(t.trusted(["Ultron"])).toBe(false); // not enough evidence yet
    t.record(["Ultron"], true, true);
    t.record(["Ultron"], true, false); // fired on a phrase without the name: harmless, counted
    expect(t.status(["Ultron"])).toMatchObject({ trusted: true, named: 8, caught: 8, extra: 1 });
    // A different wake name starts over.
    expect(t.trusted(["Jarvis"])).toBe(false);
  });
  it("negative control: a detector that misses the name too often is never trusted", () => {
    const t = fresh();
    for (let i = 0; i < 20; i++) t.record(["Ultron"], i % 4 !== 0, true); // catches 75%
    expect(t.trusted(["Ultron"])).toBe(false);
  });
});

describe("hands-free with the detector, through the real service route", async () => {
  const { startGateway } = await import("./helpers.ts");
  const { encodeWav } = await import("@ultron/audio");
  it("while learning, every phrase is still recognised; once trusted, phrases without the name skip recognition", async () => {
    const g = await startGateway();
    try {
      // A stand-in for on-PC Whisper that says what it "heard" and counts how often it was asked.
      let heard = "";
      let calls = 0;
      (g.gw.stt as any).current = () => ({ id: "local", model: "fake", privacy: "", status: () => ({ state: "ready", detail: "" }), prepare: async () => {}, transcribe: async () => (calls++, heard) });
      const send = async (file: string, text: string) => {
        heard = text;
        const res = await g.gw.app.inject({ method: "POST", url: "/api/voice/transcribe?mode=wake", headers: { authorization: `Bearer ${g.gw.token}`, host: "localhost:7477", "content-type": "audio/wav" }, payload: Buffer.from(encodeWav(wav(file))) });
        return res.json();
      };
      // Learning: the detector hears no "Ultron" in this speech, yet full recognition still runs (nothing is lost).
      expect(await send("jfk.wav", "Ultron, what's the time?")).toMatchObject({ addressed: true, text: "what's the time?" });
      expect(calls).toBe(1);
      expect(g.gw.stores.preferences.get<any>("wake_trial", null)).toMatchObject({ named: 1, caught: 0 });
      // Pretend it has proved itself on the owner's voice.
      g.gw.stores.preferences.set("wake_trial", { names: "ultron", named: 9, caught: 9, extra: 0, skipped: 0 });
      expect(await send("jfk.wav", "my fellow Americans")).toEqual({ addressed: false });
      expect(calls).toBe(1); // dropped by the detector: no full recognition
      // Negative control: with room awareness on, everything is still recognised (it needs the words).
      g.gw.room.setEnabled(true);
      expect(await send("jfk.wav", "my fellow Americans")).toEqual({ addressed: false });
      expect(calls).toBe(2);
    } finally {
      g.gw.wake.host.stop();
      await g.close();
    }
  }, 60_000);
});

describe("word error rate (used by the speech recogniser comparison)", async () => {
  const { wer } = await import("./stt-ab.real.test.ts");
  it("is 0 for a perfect transcript and counts substitutions, insertions and deletions", () => {
    expect(wer("Set a timer for ten minutes.", "set a timer for ten minutes")).toBe(0);
    expect(wer("set a timer for ten minutes", "set a time for minutes please")).toBeCloseTo(3 / 6);
    expect(wer("How much is fifteen percent of eighty?", "How much is 15% of 80?")).toBe(0);
  });
});
