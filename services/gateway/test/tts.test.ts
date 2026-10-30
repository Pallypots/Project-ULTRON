import { afterEach, describe, expect, it } from "vitest";
import { decodeWav } from "@ultron/audio";
import { startGateway } from "./helpers.ts";

let cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});
async function gateway() {
  const g = await startGateway();
  cleanup.push(g.close);
  return g;
}
const speak = (g: Awaited<ReturnType<typeof gateway>>, body: unknown) =>
  g.gw.app.inject({ method: "POST", url: "/api/voice/speak", headers: { host: "localhost:7477", authorization: `Bearer ${g.gw.token}` }, payload: body as any });

describe("spoken replies API", () => {
  it("defaults to the local Kokoro voice, not yet downloaded", async () => {
    const g = await gateway();
    const s = (await g.api("GET", "/api/voice/tts/status")).body;
    expect(s).toMatchObject({ engine: "local", voice: "bm_george", speed: 1, state: "not_loaded" });
    expect(s.voices.map((v: any) => v.id)).toContain("af_heart");
  });

  it("returns WAV audio for a sentence (test engine) and cleans text first", async () => {
    const g = await gateway();
    await g.api("PUT", "/api/voice/tts/settings", { engine: "mock" });
    const res = await speak(g, { text: "Hello there, **sir**. [memory:abcdef12]" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/wav");
    const wav = decodeWav(new Uint8Array(res.rawPayload));
    expect(wav.seconds).toBeGreaterThan(0.5);
    expect((await speak(g, { text: "🎉 [memory:abcdef12]" })).statusCode).toBe(204);
  });

  it("validates input and explains the browser-voice setting", async () => {
    const g = await gateway();
    expect((await speak(g, { text: "x".repeat(2001) })).statusCode).toBe(400);
    expect((await g.api("PUT", "/api/voice/tts/settings", { engine: "local", speed: 3 })).status).toBe(400);
    await g.api("PUT", "/api/voice/tts/settings", { engine: "browser" });
    expect((await speak(g, { text: "hello" })).statusCode).toBe(409);
    const caps = (await g.api("GET", "/api/capabilities")).body.capabilities;
    expect(caps.find((c: any) => c.id === "voice_output").detail).toMatch(/built-in voices/);
  });

  it("requires the session token", async () => {
    const g = await gateway();
    const res = await g.gw.app.inject({ method: "POST", url: "/api/voice/speak", headers: { host: "localhost:7477" }, payload: { text: "hi" } });
    expect(res.statusCode).toBe(401);
  });
});
