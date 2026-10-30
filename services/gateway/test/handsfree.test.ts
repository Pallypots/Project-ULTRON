import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startGateway } from "./helpers.ts";

const JFK = readFileSync(join(import.meta.dirname, "fixtures/jfk.wav"));
let cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
  delete process.env.ULTRON_MOCK_TRANSCRIPT_PREFIX;
});
async function gateway() {
  const g = await startGateway();
  cleanup.push(g.close);
  await g.api("PUT", "/api/voice/settings", { engine: "mock" });
  const wake = () =>
    g.gw.app.inject({ method: "POST", url: "/api/voice/transcribe?mode=wake", headers: { host: "localhost:7477", "content-type": "audio/wav", authorization: `Bearer ${g.gw.token}` }, payload: JFK });
  return { ...g, wake };
}

describe("hands-free wake mode", () => {
  it("drops speech not addressed to ULTRON without returning or logging it", async () => {
    const g = await gateway();
    const res = (await g.wake()).json();
    expect(res).toEqual({ addressed: false });
    const log = JSON.stringify((await g.api("GET", "/api/activity")).body);
    expect(log).not.toMatch(/Mock transcript/);
    expect(log).not.toMatch(/voice\.transcribed/);
  });

  it("returns only the command when addressed by name", async () => {
    process.env.ULTRON_MOCK_TRANSCRIPT_PREFIX = "Hey Ultron, ";
    const g = await gateway();
    const res = (await g.wake()).json();
    expect(res).toMatchObject({ addressed: true, text: expect.stringMatching(/^Mock transcript of 11\.0 seconds/) });
  });

  it("is refused with cloud speech recognition and audits on/off", async () => {
    const g = await gateway();
    expect((await g.api("POST", "/api/voice/handsfree", { enabled: true })).body).toMatchObject({ enabled: true, wakeNames: ["Ultron"] });
    await g.api("POST", "/api/voice/handsfree", { enabled: false });
    const actions = (await g.api("GET", "/api/activity")).body.events.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["voice.handsfree_on", "voice.handsfree_off"]));
    await g.api("PUT", "/api/voice/settings", { engine: "openai", model: "x" });
    expect((await g.api("POST", "/api/voice/handsfree", { enabled: true })).status).toBe(409);
    expect((await g.wake()).statusCode).toBe(409);
  });
});
