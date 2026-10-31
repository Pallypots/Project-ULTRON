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

  it("gives up on a pairing after five wrong codes", async () => {
    const { g, phone } = await setup();
    await g.api("PUT", "/api/remote", { enabled: true, host: HOST });
    const { code } = (await g.api("POST", "/api/remote/pairing")).body;
    const wrong = code === "999999" ? "888888" : "999999";
    for (let i = 0; i < 5; i++) await phone("POST", "/api/pair", { payload: { code: wrong } });
    expect((await phone("POST", "/api/pair", { payload: { code } })).body.message).toMatch(/No pairing is open/);
  });

  it("classifies PC-only routes", () => {
    expect(isPcOnly("GET", "/api/remote")).toBe(true);
    expect(isPcOnly("DELETE", "/api/connectors/github")).toBe(true);
    expect(isPcOnly("POST", "/api/connectors/github/connect")).toBe(true);
    expect(isPcOnly("POST", "/api/conversations/x/messages")).toBe(false);
    expect(isPcOnly("POST", "/api/actions/x/approve")).toBe(false);
  });
});
