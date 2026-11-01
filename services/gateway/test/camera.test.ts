import { afterEach, describe, expect, it } from "vitest";
import { startGateway } from "./helpers.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
// A tiny valid-looking JPEG (base64 starts with /9j/).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString("base64");

describe("camera photo with a message", () => {
  it("shows one photo to the brain for that message only, logs it, and never stores it", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const id = await g.newConversation();
    const headers = { authorization: `Bearer ${g.gw.token}`, host: "localhost:7477" };
    const bad = await g.gw.app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers, payload: { content: "what's this?", image: "PHN2Zz48L3N2Zz4=" } });
    expect(bad.statusCode).toBe(400);
    const res = await g.gw.app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers, payload: { content: "What's this?", image: JPEG } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("I was shown 1 image"); // the test brain reports what it was given
    expect(res.body).toContain("Showed your camera photo to the local brain");
    const conv = (await g.api("GET", `/api/conversations/${id}`)).body;
    expect(JSON.stringify(conv)).not.toContain(JPEG.slice(0, 12));
    expect((await g.api("GET", "/api/activity")).body.events.some((e: { action: string }) => e.action === "camera.shared")).toBe(true);
  });
});
