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
