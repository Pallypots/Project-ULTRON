import type { Stores } from "@ultron/memory";
import type { SecretStore } from "../secrets.ts";

/**
 * Smart-home control through the owner's own Home Assistant (blueprint: "Jarvis, lights"). The address is set on the PC
 * and is usually on the home network, so it isn't limited to public addresses; the long-lived token is stored encrypted
 * like other secrets and is only ever sent to that address.
 *
 * Safety: lights, plugs, fans, media players, scenes, climate and vacuums are everyday, reversible actions. Covers
 * (garage doors, gates, blinds) and scripts need approval each time. Locks, alarms and anything else are never
 * controlled; ULTRON can only report their state.
 */
export const HA_SECRET = "HOME_ASSISTANT_TOKEN";
export const HA_URL_PREF = "home_assistant_url";

export interface HaEntity {
  id: string;
  domain: string;
  name: string;
  state: string;
  attributes: Record<string, unknown>;
}

export const EVERYDAY = new Set(["light", "switch", "fan", "input_boolean", "media_player", "scene", "climate", "vacuum"]);
export const SENSITIVE = new Set(["cover", "script"]);
const READABLE = new Set([...EVERYDAY, ...SENSITIVE, "lock", "sensor", "binary_sensor", "alarm_control_panel", "weather", "person"]);

export class HomeError extends Error {}

/** Tidies an owner-typed address into a base URL, or null. */
export function haBase(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    if (u.username || u.password || u.search || u.hash) return null;
    return `${u.origin}${u.pathname.replace(/\/+(?:api\/?)?$/, "")}`;
  } catch {
    return null;
  }
}

/** Words that say which kind of device is meant. */
const KIND_WORDS: [RegExp, string[]][] = [
  [/\b(lights?|lamps?|bulbs?|lighting)\b/, ["light"]],
  [/\b(fans?)\b/, ["fan"]],
  [/\b(plugs?|sockets?|outlets?|switch(?:es)?)\b/, ["switch", "input_boolean"]],
  [/\b(tv|television|speakers?|music)\b/, ["media_player"]],
  [/\b(heating|heater|thermostat|ac|air ?con(?:ditioning)?|temperature)\b/, ["climate"]],
  [/\b(vacuum|hoover|roomba|robot)\b/, ["vacuum"]],
  [/\b(blinds?|curtains?|shutters?|garage(?: door)?|gate|awning)\b/, ["cover"]],
  [/\b(scene|mood)\b/, ["scene"]],
  [/\b(locks?|door locks?)\b/, ["lock"]],
];
const FILLER = /\b(the|my|all|of|in|a|an|please|lights?|lamps?|bulbs?|lighting|fans?|plugs?|sockets?|outlets?|switch(?:es)?|tv|television|devices?|everything|room|scene)\b/g;

/** Finds the devices a phrase like "the kitchen lights" or "living room lamp" means. */
export function matchEntities(all: HaEntity[], phrase: string): HaEntity[] {
  const q = phrase.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!q) return [];
  const kinds = KIND_WORDS.filter(([re]) => re.test(q)).flatMap(([, d]) => d);
  const pool = kinds.length ? all.filter((e) => kinds.includes(e.domain)) : all;
  const words = q.replace(FILLER, " ").split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return kinds.length ? pool : [];
  const name = (e: HaEntity) => `${e.name} ${e.id.split(".")[1]?.replace(/_/g, " ")} ${e.domain.replace("_", " ")}`.toLowerCase();
  const exact = pool.filter((e) => e.name.toLowerCase() === q || e.name.toLowerCase() === words.join(" "));
  if (exact.length) return exact;
  const scored = pool.map((e) => ({ e, s: words.filter((w) => name(e).includes(w)).length })).filter((x) => x.s > 0);
  const best = Math.max(0, ...scored.map((x) => x.s));
  return scored.filter((x) => x.s === best && best === words.length).map((x) => x.e);
}

export class HomeService {
  private cache: { at: number; entities: HaEntity[] } | null = null;
  lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private stores: Stores,
    private secrets: SecretStore,
  ) {}

  get connected() {
    return this.secrets.has(HA_SECRET) && Boolean(this.base());
  }
  base(): string {
    return this.stores.preferences.get<string>(HA_URL_PREF, "");
  }

  private async req(base: string, token: string, path: string, init: RequestInit = {}): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(8000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" } });
    } catch (err) {
      throw new HomeError((err as Error).name === "TimeoutError" ? "Home Assistant took too long to answer." : `Couldn't reach Home Assistant at ${base}. Is it on, and is the address right?`);
    }
    if (res.status === 401 || res.status === 403) throw new HomeError("Home Assistant refused the token. Create a new long-lived access token (your profile → Security) and connect again.");
    if (!res.ok) throw new HomeError(`Home Assistant answered ${res.status}.`);
    return res.json().catch(() => {
      throw new HomeError("That address didn't answer like Home Assistant.");
    });
  }

  /** Checks the address and token really work before saving them. */
  async connect(rawUrl: string, token: string): Promise<{ devices: number }> {
    const base = haBase(rawUrl);
    if (!base) throw new HomeError('That doesn\'t look like an address. Try something like "http://homeassistant.local:8123".');
    const hello = await this.req(base, token.trim(), "/api/");
    if (typeof hello?.message !== "string") throw new HomeError("That address didn't answer like Home Assistant.");
    const states = await this.req(base, token.trim(), "/api/states");
    this.stores.preferences.set(HA_URL_PREF, base);
    this.secrets.set(HA_SECRET, token.trim());
    this.cache = { at: Date.now(), entities: toEntities(states) };
    this.lastError = null;
    this.start();
    return { devices: this.cache.entities.filter((e) => EVERYDAY.has(e.domain) || SENSITIVE.has(e.domain)).length };
  }

  disconnect() {
    this.secrets.set(HA_SECRET, null);
    this.stores.preferences.set(HA_URL_PREF, "");
    this.cache = null;
    this.stop();
  }

  /** Keeps a fresh copy of the device list, so "lights off" can be matched instantly. */
  start() {
    if (this.timer || !this.connected) return;
    void this.entities(true).catch(() => {});
    this.timer = setInterval(() => void this.entities(true).catch(() => {}), 120_000);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async entities(fresh = false): Promise<HaEntity[]> {
    if (!this.connected) throw new HomeError("Home Assistant isn't connected. Add it in Connections → Home.");
    if (!fresh && this.cache && Date.now() - this.cache.at < 15_000) return this.cache.entities;
    try {
      const states = await this.req(this.base(), this.secrets.get(HA_SECRET)!, "/api/states");
      this.cache = { at: Date.now(), entities: toEntities(states) };
      this.lastError = null;
      return this.cache.entities;
    } catch (err) {
      this.lastError = (err as Error).message;
      throw err;
    }
  }

  /** The last known device list, without waiting (empty if never loaded). */
  cached(): HaEntity[] {
    return this.cache?.entities ?? [];
  }

  async call(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
    await this.req(this.base(), this.secrets.get(HA_SECRET)!, `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, { method: "POST", body: JSON.stringify(data) });
    if (this.cache) this.cache.at = 0; // states changed
  }

  status() {
    return { connected: this.connected, url: this.base() || null, devices: this.cached().filter((e) => EVERYDAY.has(e.domain) || SENSITIVE.has(e.domain)).length, error: this.lastError };
  }
}

function toEntities(states: unknown): HaEntity[] {
  if (!Array.isArray(states)) return [];
  return states
    .filter((s): s is { entity_id: string; state: string; attributes?: Record<string, unknown> } => typeof s?.entity_id === "string")
    .map((s) => ({ id: s.entity_id, domain: s.entity_id.split(".")[0]!, name: String(s.attributes?.friendly_name ?? s.entity_id).slice(0, 80), state: String(s.state).slice(0, 40), attributes: s.attributes ?? {} }))
    .filter((e) => READABLE.has(e.domain) && !e.id.startsWith("sensor.") || (e.domain === "sensor" && /temperature|humidity|power|energy|battery/.test(String(e.attributes.device_class ?? ""))));
}

/** A short, plain description of a device's state. */
export function describeEntity(e: HaEntity): string {
  const a = e.attributes;
  const bits = [e.state];
  if (e.domain === "light" && e.state === "on" && typeof a.brightness === "number") bits.push(`${Math.round((a.brightness / 255) * 100)}% brightness`);
  if (e.domain === "climate" && a.temperature != null) bits.push(`set to ${a.temperature}°${a.current_temperature != null ? `, currently ${a.current_temperature}°` : ""}`);
  if (e.domain === "sensor") bits[0] = `${e.state}${a.unit_of_measurement ?? ""}`;
  if (e.domain === "media_player" && a.media_title) bits.push(`playing ${String(a.media_title).slice(0, 60)}`);
  return `${e.name}: ${bits.join(", ")}`;
}
