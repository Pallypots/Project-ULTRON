import { afterEach, describe, expect, it } from "vitest";
import { isPcOnly } from "../src/remote.ts";
import { startGateway } from "./helpers.ts";

const HOST = "my-pc.tail1234.ts.net";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function setup() {
  const g = await startGateway();
  cleanup.push(g.close);
  // What `tailscale serve` forwards: same local connection, but the Host is the PC's tailnet name.
  const phone = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, opts: { token?: string; payload?: unknown; origin?: string } = {}) => {
    const res = await g.gw.app.inject({
      method,
      url,
      headers: { host: HOST, ...(opts.origin ? { origin: opts.origin } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
      payload: opts.payload as any,
    });
    return { status: res.statusCode, body: res.headers["content-type"]?.includes("json") ? res.json() : res.body };
  };
  return { g, phone };
}

describe("phone access over Tailscale", () => {
  it("is refused entirely until the owner turns it on, and never accepts other addresses", async () => {
    const { g, phone } = await setup();
    expect((await phone("GET", "/api/health")).status).toBe(403);
    expect((await g.api("PUT", "/api/remote", { enabled: true, host: "not a host" })).status).toBe(400);
    expect((await g.api("PUT", "/api/remote", { enabled: true, host: "localhost" })).status).toBe(400);
    expect((await g.api("PUT", "/api/remote", { enabled: true, host: `https://${HOST}/` })).body.settings).toEqual({ enabled: true, host: HOST });
    expect((await phone("GET", "/api/health")).status).toBe(200);
    // A different site's page in the phone's browser can't call ULTRON.
    expect((await phone("GET", "/api/health", { origin: "https://evil.example" })).status).toBe(403);
    const other = await g.gw.app.inject({ method: "GET", url: "/api/health", headers: { host: "other-pc.tail1234.ts.net" } });
    expect(other.statusCode).toBe(403);
  });

  it("pairs with a short code shown on the PC; the phone never gets the PC's key", async () => {
    const { g, phone } = await setup();
    await g.api("PUT", "/api/remote", { enabled: true, host: HOST });
    expect((await phone("GET", "/api/bootstrap")).body.error).toBe("pair_required");
    expect((await phone("GET", "/api/status")).status).toBe(401);
    expect((await phone("GET", "/api/status", { token: g.gw.token })).status).toBe(401); // the PC key is useless remotely
    expect((await phone("POST", "/api/pair", { payload: { code: "123456" } })).body.message).toMatch(/No pairing is open/);
    // Starting pairing is PC-only.
    expect((await phone("POST", "/api/remote/pairing")).status).toBe(401);
    const { code } = (await g.api("POST", "/api/remote/pairing")).body;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await phone("POST", "/api/pair", { payload: { code: wrong } })).body.message).toMatch(/isn't right/);
    const paired = await phone("POST", "/api/pair", { payload: { code, name: "Jimmy's iPhone" } });
    expect(paired.status).toBe(200);
    const token = paired.body.token as string;
    expect(token).not.toBe(g.gw.token);
    // The code works once.
    expect((await phone("POST", "/api/pair", { payload: { code } })).status).toBe(403);
    expect((await phone("GET", "/api/status", { token })).status).toBe(200);
    const id = await phone("POST", "/api/conversations", { token });
    expect(id.status).toBe(200);
    expect((await g.api("GET", "/api/remote")).body.devices[0]).toMatchObject({ name: "Jimmy's iPhone", revokedAt: null });
  });

  it("keeps sensitive settings PC-only, and revoking a phone locks it out immediately", async () => {
    const { g, phone } = await setup();
    await g.api("PUT", "/api/remote", { enabled: true, host: HOST });
    const { code } = (await g.api("POST", "/api/remote/pairing")).body;
    const { token, device } = (await phone("POST", "/api/pair", { payload: { code } })).body;
    expect((await phone("PUT", "/api/settings/provider", { token, payload: { provider: "anthropic", apiKey: "sk-ant-x" } })).body.error).toBe("pc_only");
    expect((await phone("POST", "/api/files/folders", { token, payload: { path: "C:\\\\" } })).body.error).toBe("pc_only");
    expect((await phone("GET", "/api/remote", { token })).body.error).toBe("pc_only");
    expect((await phone("GET", "/api/memories/export", { token })).body.error).toBe("pc_only");
    expect((await phone("GET", "/api/settings/provider", { token })).status).toBe(200); // reading is fine
    expect((await phone("PUT", "/api/settings/actions", { token, payload: { paused: true, confirmLowRisk: false } })).status).toBe(200); // the kill switch works from the phone
    expect((await g.api("DELETE", `/api/remote/devices/${device.id}`)).status).toBe(200);
    expect((await phone("GET", "/api/status", { token })).status).toBe(401);
    // Turning phone access off locks every phone out.
    const second = (await phone("POST", "/api/pair", { payload: { code: (await g.api("POST", "/api/remote/pairing")).body.code } })).body.token;
    await g.api("PUT", "/api/remote", { enabled: false, host: HOST });
    expect((await phone("GET", "/api/status", { token: second })).status).toBe(403);
  });

  it("locks out whoever guesses wrong five times, without spoiling pairing for the owner", async () => {
    const { g } = await setup();
    await g.api("PUT", "/api/remote", { enabled: true, host: HOST });
    const { code } = (await g.api("POST", "/api/remote/pairing")).body;
    const wrong = code === "999999" ? "888888" : "999999";
    const pairAs = async (who: string, c: string) =>
      (await g.gw.app.inject({ method: "POST", url: "/api/pair", headers: { host: HOST, "tailscale-user-login": who }, payload: { code: c } })).json();
    for (let i = 0; i < 5; i++) await pairAs("mallory@example.com", wrong);
    // Mallory is locked out, even with the right code...
    expect((await pairAs("mallory@example.com", code)).message).toMatch(/Too many wrong codes/);
    // ...but the owner can still pair.
    expect((await pairAs("owner@example.com", code)).token).toBeTruthy();
  });

  it("refuses '#' tricks and keeps safety settings tightening-only from a phone (found by review)", async () => {
    const { g, phone } = await setup();
    await g.api("PUT", "/api/remote", { enabled: true, host: HOST });
    const { token } = (await phone("POST", "/api/pair", { payload: { code: (await g.api("POST", "/api/remote/pairing")).body.code } })).body;
    // Over a real socket, "/api/remote#x" would reach /api/remote; the gateway now refuses any "#".
    const { request } = await import("node:http");
    await g.gw.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (g.gw.app.server.address() as { port: number }).port;
    const status = await new Promise<number>((resolve) => {
      const r = request({ host: "127.0.0.1", port, method: "GET", path: "/api/remote#x", headers: { host: HOST, authorization: `Bearer ${token}` } }, (res) => resolve(res.statusCode!));
      r.end();
    });
    expect(status).toBe(400);
    // The phone can pause actions (kill switch) but can't loosen safety again or change voice/routines/persona.
    expect((await phone("PUT", "/api/settings/actions", { token, payload: { paused: true, confirmLowRisk: true } })).status).toBe(200);
    expect((await phone("PUT", "/api/settings/actions", { token, payload: { paused: false, confirmLowRisk: true } })).body.error).toBe("pc_only");
    expect((await phone("PUT", "/api/settings/actions", { token, payload: { paused: true, confirmLowRisk: false } })).body.error).toBe("pc_only");
    for (const [m, url] of [["PUT", "/api/voice/settings"], ["PUT", "/api/routines"], ["PUT", "/api/persona"], ["POST", "/api/files/open"], ["PUT", "/api/connectors/github/repos"]] as const)
      expect((await phone(m, url, { token, payload: {} })).body.error, url).toBe("pc_only");
  });

  it("classifies PC-only routes", () => {
    expect(isPcOnly("GET", "/api/remote")).toBe(true);
    expect(isPcOnly("DELETE", "/api/connectors/github")).toBe(true);
    expect(isPcOnly("POST", "/api/connectors/github/connect")).toBe(true);
    expect(isPcOnly("POST", "/api/conversations/x/messages")).toBe(false);
    expect(isPcOnly("POST", "/api/actions/x/approve")).toBe(false);
  });
});
