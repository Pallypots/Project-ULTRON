import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { detectQuickCommand } from "@ultron/agent-core";
import { matchEntities, type HaEntity } from "../src/home/assistant.ts";
import { replyText, startGateway } from "./helpers.ts";

const TOKEN = "ha-long-lived-token-0123456789abcdef";
const states = [
  { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen Lights", brightness: 200 } },
  { entity_id: "light.living_room_lamp", state: "off", attributes: { friendly_name: "Living Room Lamp" } },
  { entity_id: "switch.coffee_machine", state: "off", attributes: { friendly_name: "Coffee Machine" } },
  { entity_id: "cover.garage_door", state: "closed", attributes: { friendly_name: "Garage Door" } },
  { entity_id: "lock.front_door", state: "locked", attributes: { friendly_name: "Front Door" } },
  { entity_id: "switch.garage_opener", state: "off", attributes: { friendly_name: "Garage Opener" } },
  { entity_id: "scene.away", state: "scening", attributes: { friendly_name: "Away" } },
  { entity_id: "climate.hallway", state: "heat", attributes: { friendly_name: "Heating", temperature: 19, current_temperature: 18.5 } },
  { entity_id: "sensor.outside_temp", state: "7.5", attributes: { friendly_name: "Outside Temperature", device_class: "temperature", unit_of_measurement: "°C" } },
];
const calls: { path: string; body: any }[] = [];
let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(401).end();
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/") return res.end(JSON.stringify({ message: "API running." }));
      if (req.url === "/api/states") return res.end(JSON.stringify(states));
      if (req.method === "POST" && req.url?.startsWith("/api/services/")) {
        calls.push({ path: req.url, body: JSON.parse(raw || "{}") });
        return res.end("[]");
      }
      res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const ents: HaEntity[] = states.map((s) => ({ id: s.entity_id, domain: s.entity_id.split(".")[0]!, name: s.attributes.friendly_name, state: s.state, attributes: s.attributes }));

describe("smart home (Home Assistant)", () => {
  it("understands what devices a phrase means", () => {
    expect(matchEntities(ents, "the lights").map((e) => e.id)).toEqual(["light.kitchen", "light.living_room_lamp"]);
    expect(matchEntities(ents, "kitchen lights").map((e) => e.id)).toEqual(["light.kitchen"]);
    expect(matchEntities(ents, "living room lamp").map((e) => e.id)).toEqual(["light.living_room_lamp"]);
    expect(matchEntities(ents, "coffee machine").map((e) => e.id)).toEqual(["switch.coffee_machine"]);
    expect(matchEntities(ents, "computer")).toEqual([]);
    expect(detectQuickCommand("Ultron, turn off the kitchen lights")).toEqual({ type: "home", action: "off", target: "kitchen lights" });
    expect(detectQuickCommand("dim the lights to 20%")).toEqual({ type: "home", action: "brightness", target: "lights", value: 20 });
  });

  it("connects only with a working token, runs everyday commands instantly, and never touches locks", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const id = await g.newConversation();
    // Not connected: "lights off" isn't an instant command (the brain answers instead).
    expect(replyText(await g.chat(id, "lights off"))).not.toMatch(/^Done:/);
    expect((await g.api("PUT", "/api/home", { url: base, token: "wrong-token-000000000000" })).body.message).toMatch(/refused the token/);
    const ok = await g.api("PUT", "/api/home", { url: `${base}/api/`, token: TOKEN });
    expect(ok.body).toMatchObject({ home: { connected: true, url: base }, devices: 7 });
    expect(JSON.stringify((await g.api("GET", "/api/home")).body)).not.toContain(TOKEN);

    expect(replyText(await g.chat(id, "turn off the kitchen lights"))).toBe("Done: Kitchen Lights off.");
    expect(calls.at(-1)).toEqual({ path: "/api/services/homeassistant/turn_off", body: { entity_id: "light.kitchen" } });
    expect(replyText(await g.chat(id, "dim the living room lamp to 25%"))).toBe("Done: Living Room Lamp set to 25%.");
    expect(calls.at(-1)).toEqual({ path: "/api/services/light/turn_on", body: { entity_id: "light.living_room_lamp", brightness_pct: 25 } });
    expect(replyText(await g.chat(id, "make the kitchen lights red"))).toBe("Done: Kitchen Lights now red. Much better.");
    expect(calls.at(-1)).toEqual({ path: "/api/services/light/turn_on", body: { entity_id: "light.kitchen", color_name: "red" } });
    expect(replyText(await g.chat(id, "set the heating to 21"))).toBe("Done: Heating set to 21°.");
    expect(calls.at(-1)!.body).toEqual({ entity_id: "climate.hallway", temperature: 21 });

    // Locks: never, even when asked directly through the tool.
    const n = calls.length;
    expect(replyText(await g.chat(id, 'mock-tool home_control {"target":"front door lock","action":"off"}'))).toMatch(/never unlocks doors/);
    // Garage door: waits for approval.
    expect(replyText(await g.chat(id, 'mock-tool home_cover_or_script {"target":"garage door","action":"open"}'))).toMatch(/approval/i);
    // Door-like switches and scenes (which can unlock doors through automations) never go through everyday control...
    expect(replyText(await g.chat(id, 'mock-tool home_control {"target":"garage opener","action":"on"}'))).toMatch(/needs the owner's approval/);
    expect(replyText(await g.chat(id, "turn on the garage opener"))).not.toMatch(/^Done/);
    expect(replyText(await g.chat(id, 'mock-tool home_control {"target":"away scene","action":"activate"}'))).toMatch(/needs the owner's approval/);
    // ...and the approval card names exactly what would be operated.
    const card = (await g.api("GET", "/api/actions")).body.pending.find((a: { tool: string }) => a.tool === "home_cover_or_script");
    expect(card.preview).toBe("Will open exactly: Garage Door (cover.garage_door)");
    expect(replyText(await g.chat(id, 'mock-tool home_cover_or_script {"target":"cover","action":"open"}'))).toMatch(/approval/i);
    expect(calls.length).toBe(n);
    const caps = (await g.api("GET", "/api/capabilities")).body.capabilities;
    expect(caps.find((c: { id: string }) => c.id === "home")).toMatchObject({ status: "enabled" });

    await g.api("DELETE", "/api/home");
    expect((await g.api("GET", "/api/home")).body.home.connected).toBe(false);
  });
});
