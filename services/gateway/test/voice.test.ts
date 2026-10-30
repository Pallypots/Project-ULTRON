import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeWav } from "@ultron/audio";
import { startGateway } from "./helpers.ts";

const JFK = readFileSync(join(import.meta.dirname, "fixtures/jfk.wav"));
const tone = (seconds: number, amp = 0.3) => encodeWav(Float32Array.from({ length: 16000 * seconds }, (_, i) => amp * Math.sin(i / 5)));

let cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});
async function gateway() {
  const g = await startGateway();
  cleanup.push(g.close);
  await g.api("PUT", "/api/voice/settings", { engine: "mock" });
  const transcribe = (body: Uint8Array | string, contentType = "audio/wav", auth = true) =>
    g.gw.app.inject({
      method: "POST",
      url: "/api/voice/transcribe",
      headers: { host: "localhost:7477", "content-type": contentType, ...(auth ? { authorization: `Bearer ${g.gw.token}` } : {}) },
      payload: Buffer.from(body),
    });
  return { ...g, transcribe };
}

describe("voice: push-to-talk transcription API", () => {
  it("transcribes WAV audio with the configured engine", async () => {
    const { transcribe } = await gateway();
    const res = await transcribe(JFK);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ engine: "mock", audioSeconds: expect.any(Number) });
    expect(body.audioSeconds).toBeGreaterThan(10);
    expect(body.text).toMatch(/Mock transcript of 11\.0 seconds/);
  });

  it("requires the session token", async () => {
    const { transcribe } = await gateway();
    expect((await transcribe(JFK, "audio/wav", false)).statusCode).toBe(401);
  });

  it("rejects non-audio, too-short, silent and too-long recordings with clear messages", async () => {
    const { transcribe } = await gateway();
    expect((await transcribe("hello", "text/plain")).statusCode).toBe(415);
    expect((await transcribe(new TextEncoder().encode("not a wav file at all, honestly, nope"))).statusCode).toBe(400);
    const short = await transcribe(tone(0.1));
    expect(short.statusCode).toBe(400);
    expect(short.json().message).toMatch(/too short/);
    const silent = await transcribe(tone(1, 0));
    expect(silent.statusCode).toBe(422);
    expect(silent.json().message).toMatch(/didn't hear anything/);
    expect((await transcribe(tone(121, 0.1))).statusCode).toBe(413);
  });

  it("never stores audio or transcript text in the audit log", async () => {
    const { transcribe, api } = await gateway();
    await transcribe(JFK);
    const events = (await api("GET", "/api/activity")).body.events.filter((e: any) => e.action === "voice.transcribed");
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(/Mock transcript/);
    expect(Object.keys(events[0].detail).sort()).toEqual(["chars", "engine", "ms", "seconds"]);
  });

  it("reports engine status, privacy and settings changes", async () => {
    const { api } = await gateway();
    const status = (await api("GET", "/api/voice/status")).body;
    expect(status).toMatchObject({ engine: "mock", state: "ready", maxSeconds: 120 });
    const local = (await api("PUT", "/api/voice/settings", { engine: "local" })).body;
    expect(local).toMatchObject({ engine: "local", model: "Xenova/whisper-base.en", state: "not_loaded" });
    expect(local.privacy).toMatch(/never leaves/);
    const openai = (await api("PUT", "/api/voice/settings", { engine: "openai", model: "some-model" })).body;
    expect(openai.state).toBe("not_configured");
    expect((await api("PUT", "/api/voice/settings", { engine: "telepathy" })).status).toBe(400);
  });

  it("stores voice messages as transcripts marked inputMode=voice", async () => {
    const { chat, api, newConversation } = await gateway();
    const id = await newConversation();
    const res = await api("POST", `/api/conversations/${id}/messages`, { content: "hello by voice", inputMode: "voice" });
    expect(res.status).toBe(200);
    await chat(id, "typed one");
    const msgs = (await api("GET", `/api/conversations/${id}`)).body.messages.filter((m: any) => m.role === "user");
    expect(msgs.map((m: any) => m.inputMode)).toEqual(["voice", "text"]);
  });
});
