import { z } from "zod";
import { describeEntity, EVERYDAY, matchEntities, securityLike, SENSITIVE, type HaEntity, type HomeService } from "../home/assistant.ts";

/** The app's Home Assistant link, so approval cards can list exactly which devices an action would operate. */
let homeForPreview: HomeService | null = null;
export function setHomeForPreview(h: HomeService) {
  homeForPreview = h;
}
import type { ToolContext, ToolDef } from "./tools.ts";

const notConnected = JSON.stringify({ connected: false, note: "Home Assistant isn't connected. The owner can connect it in Connections → Home. Say so; don't pretend." });

const homeDevices: ToolDef<{ query?: string }> = {
  name: "home_devices",
  description: "Smart home (Home Assistant): list devices and their current state (lights, plugs, heating, blinds, locks, sensors). Optional query like 'kitchen lights' or 'temperature'.",
  input: z.object({ query: z.string().trim().max(100).optional() }).strict(),
  parameters: { type: "object", properties: { query: { type: "string", description: "What to look for, e.g. 'living room' or 'lights' (optional)" } }, additionalProperties: false },
  risk: 0,
  timeoutMs: 10_000,
  describe: (i) => (i.query ? `Check the smart home: ${i.query}` : "Check the smart home"),
  run: async (i, ctx) => {
    if (!ctx.home?.connected) return notConnected;
    const all = await ctx.home.entities();
    const found = i.query ? matchEntities(all, i.query) : all.filter((e) => e.domain !== "sensor");
    return JSON.stringify({ count: found.length, devices: found.slice(0, 40).map((e) => ({ id: e.id, untrusted_state: describeEntity(e) })), note: found.length ? undefined : "No matching devices." });
  },
};

const Action = z.enum(["on", "off", "toggle", "brightness", "set_temperature", "activate", "start", "dock", "color"]);
const COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "white", "warmwhite", "cyan", "magenta", "teal", "gold", "crimson", "violet", "lime", "turquoise", "amber"] as const;
const ControlInput = z.object({ target: z.string().trim().min(2).max(100), action: Action, value: z.number().min(0).max(100).optional(), color: z.enum(COLORS).optional() }).strict();
type ControlIn = z.infer<typeof ControlInput>;

/** Maps an everyday action onto Home Assistant services for each device. */
function plan(e: HaEntity, i: ControlIn): { domain: string; service: string; data: Record<string, unknown> } | string {
  const id = { entity_id: e.id };
  switch (i.action) {
    case "on":
    case "off":
    case "toggle":
      if (e.domain === "scene") return { domain: "scene", service: "turn_on", data: id };
      if (e.domain === "vacuum") return { domain: "vacuum", service: i.action === "off" ? "return_to_base" : "start", data: id };
      return { domain: "homeassistant", service: `turn_${i.action}`.replace("turn_toggle", "toggle"), data: id };
    case "brightness":
      if (e.domain !== "light") return `${e.name} isn't a dimmable light`;
      return { domain: "light", service: "turn_on", data: { ...id, brightness_pct: Math.round(i.value ?? 50) } };
    case "color":
      if (e.domain !== "light") return `${e.name} isn't a light`;
      if (!i.color) return "Say which colour";
      if (i.color === "warmwhite") return { domain: "light", service: "turn_on", data: { ...id, color_temp_kelvin: 2700 } };
      return { domain: "light", service: "turn_on", data: { ...id, color_name: i.color === "amber" ? "orange" : i.color } };
    case "set_temperature":
      if (e.domain !== "climate") return `${e.name} isn't a thermostat`;
      if (i.value == null || i.value < 5 || i.value > 30) return "Give a temperature between 5 and 30 degrees";
      return { domain: "climate", service: "set_temperature", data: { ...id, temperature: i.value } };
    case "activate":
      return e.domain === "scene" ? { domain: "scene", service: "turn_on", data: id } : `${e.name} isn't a scene`;
    case "start":
    case "dock":
      return e.domain === "vacuum" ? { domain: "vacuum", service: i.action === "start" ? "start" : "return_to_base", data: id } : `${e.name} isn't a vacuum`;
  }
}

/** Which devices a request may operate: everyday ones (never door/gate/alarm-like), or the approval-only kind. */
function allowedFor(sensitive: boolean) {
  return (e: HaEntity) => (sensitive ? SENSITIVE.has(e.domain) || (e.domain === "switch" && securityLike(e)) : EVERYDAY.has(e.domain) && !securityLike(e));
}
const MAX_SENSITIVE = 6;

function sensitivePlan(e: HaEntity, action: "open" | "close" | "run") {
  const id = { entity_id: e.id };
  if (e.domain === "cover") return action === "run" ? `${e.name} is a cover: say open or close` : { domain: "cover", service: action === "open" ? "open_cover" : "close_cover", data: id };
  if (e.domain === "scene" || e.domain === "script") return { domain: e.domain, service: "turn_on", data: id };
  // input_boolean helpers and door-like switches: open/run = on, close = off.
  return { domain: "homeassistant", service: action === "close" ? "turn_off" : "turn_on", data: id };
}

async function control(i: ControlIn, ctx: ToolContext, sensitive: boolean, open?: "open" | "close" | "run") {
  if (!ctx.home?.connected) return notConnected;
  const all = await ctx.home.entities();
  const matched = matchEntities(all, i.target);
  const ok = allowedFor(sensitive);
  if (!matched.length) return JSON.stringify({ error: `No device matches "${i.target}".`, untrusted_known_devices: all.filter((e) => EVERYDAY.has(e.domain) || SENSITIVE.has(e.domain)).slice(0, 25).map((e) => e.name) });
  const refused = matched.filter((e) => !ok(e));
  const targets = matched.filter(ok);
  if (sensitive && targets.length > MAX_SENSITIVE) return JSON.stringify({ error: `That matches ${targets.length} devices; name the one you mean.` });
  if (!targets.length) {
    if (refused.some((e) => e.domain === "lock" || e.domain === "alarm_control_panel")) return JSON.stringify({ error: "For safety, ULTRON never unlocks doors or changes alarms. Use the Home Assistant app." });
    if (!sensitive && refused.some((e) => SENSITIVE.has(e.domain) || securityLike(e)))
      return JSON.stringify({ error: `${refused.map((e) => e.name).join(", ")} can open doors or run automations, so it needs the owner's approval: use home_cover_or_script.` });
    return JSON.stringify({ error: `${refused.map((e) => e.name).join(", ")} can't be controlled this way.` });
  }
  const done: string[] = [];
  const problems: string[] = [];
  for (const e of targets) {
    const p = open ? sensitivePlan(e, open) : plan(e, i);
    if (typeof p === "string") {
      problems.push(p);
      continue;
    }
    if (ctx.dryRun) {
      done.push(e.name);
      continue;
    }
    await ctx.home.call(p.domain, p.service, p.data);
    done.push(e.name);
  }
  return JSON.stringify({ done, action: open ?? i.action, value: i.value, color: i.color, problems: problems.length ? problems : undefined, not_controlled: refused.length ? refused.map((e) => e.name) : undefined, dry_run: ctx.dryRun || undefined });
}

const homeControl: ToolDef<ControlIn> = {
  name: "home_control",
  description:
    "Smart home (Home Assistant): turn lights, plugs, fans, TVs and vacuums on/off, dim lights (action 'brightness', value 0-100), change light colour (action 'color', color) or set the heating (action 'set_temperature', value in degrees). target is what the owner called it, e.g. 'kitchen lights', 'all lights', 'fan'. Garage doors, gates, blinds, scenes and scripts use home_cover_or_script (approval); locks and alarms are never controlled.",
  input: ControlInput,
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "Device or room, e.g. 'living room lamp', 'the lights'" },
      action: { type: "string", enum: Action.options },
      value: { type: "number", description: "Brightness % or temperature °" },
      color: { type: "string", enum: [...COLORS], description: "For action 'color'" },
    },
    required: ["target", "action"],
    additionalProperties: false,
  },
  risk: 1,
  timeoutMs: 15_000,
  describe: (i) =>
    i.action === "color" ? `Make ${i.target} ${i.color}` : i.action === "brightness" ? `Set ${i.target} to ${i.value ?? 50}% brightness` : i.action === "set_temperature" ? `Set ${i.target} to ${i.value}°` : i.action === "activate" ? `Activate the "${i.target}" scene` : `Turn ${i.action === "toggle" ? "over" : i.action} ${i.target}`,
  run: (i, ctx) => control(i, ctx, false),
};

const CoverInput = z.object({ target: z.string().trim().min(2).max(100), action: z.enum(["open", "close", "run"]) }).strict();
const homeCover: ToolDef<z.infer<typeof CoverInput>> = {
  name: "home_cover_or_script",
  description:
    "Smart home, always with the owner's approval: open/close garage doors, gates and blinds (and door-like switches), or run a scene, script or helper toggle ('run'). Name the specific device. Locks and alarms are never controlled.",
  input: CoverInput,
  parameters: { type: "object", properties: { target: { type: "string" }, action: { type: "string", enum: ["open", "close", "run"] } }, required: ["target", "action"], additionalProperties: false },
  risk: 2,
  timeoutMs: 15_000,
  describe: (i) => (i.action === "run" ? `Run "${i.target}" in Home Assistant` : `${i.action === "open" ? "Open" : "Close"} ${i.target}`),
  // The approval card names exactly which devices would be operated.
  preview: (i) => {
    const all = homeForPreview?.cached() ?? [];
    const hits = matchEntities(all, i.target).filter(allowedFor(true));
    if (!hits.length) return "No matching device found right now; nothing will be operated.";
    if (hits.length > MAX_SENSITIVE) return `Matches ${hits.length} devices; it will be refused. Name the one you mean.`;
    return `Will ${i.action} exactly: ${hits.map((e) => `${e.name} (${e.id})`).join(", ")}`;
  },
  run: (i, ctx) => control({ target: i.target, action: "on" }, ctx, true, i.action),
};

export const HOME_TOOLS: ToolDef[] = [homeDevices, homeControl, homeCover];
