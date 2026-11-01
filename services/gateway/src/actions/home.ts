import { z } from "zod";
import { describeEntity, EVERYDAY, matchEntities, SENSITIVE, type HaEntity } from "../home/assistant.ts";
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

const Action = z.enum(["on", "off", "toggle", "brightness", "set_temperature", "activate", "start", "dock"]);
const ControlInput = z.object({ target: z.string().trim().min(2).max(100), action: Action, value: z.number().min(0).max(100).optional() }).strict();
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

async function control(i: ControlIn, ctx: ToolContext, allowed: Set<string>, open?: "open" | "close") {
  if (!ctx.home?.connected) return notConnected;
  const all = await ctx.home.entities();
  const matched = matchEntities(all, i.target);
  if (!matched.length) return JSON.stringify({ error: `No device matches "${i.target}".`, known: all.filter((e) => EVERYDAY.has(e.domain) || SENSITIVE.has(e.domain)).slice(0, 25).map((e) => e.name) });
  const refused = matched.filter((e) => !allowed.has(e.domain));
  const targets = matched.filter((e) => allowed.has(e.domain)).slice(0, 25);
  if (!targets.length)
    return JSON.stringify({ error: refused.some((e) => e.domain === "lock" || e.domain === "alarm_control_panel") ? "For safety, ULTRON never unlocks doors or changes alarms. Use the Home Assistant app." : `${refused.map((e) => e.name).join(", ")} can't be controlled this way.` });
  const done: string[] = [];
  const problems: string[] = [];
  for (const e of targets) {
    const p = open ? { domain: "cover", service: open === "open" ? "open_cover" : "close_cover", data: { entity_id: e.id } } : plan(e, i);
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
  return JSON.stringify({ done, action: open ?? i.action, value: i.value, problems: problems.length ? problems : undefined, not_controlled: refused.length ? refused.map((e) => e.name) : undefined, dry_run: ctx.dryRun || undefined });
}

const homeControl: ToolDef<ControlIn> = {
  name: "home_control",
  description:
    "Smart home (Home Assistant): turn lights, plugs, fans, TVs and vacuums on/off, dim lights (action 'brightness', value 0-100), set the heating (action 'set_temperature', value in degrees) or activate a scene. target is what the owner called it, e.g. 'kitchen lights', 'all lights', 'fan'. Garage doors, blinds and scripts use home_cover_or_script; locks and alarms are never controlled.",
  input: ControlInput,
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "Device or room, e.g. 'living room lamp', 'the lights'" },
      action: { type: "string", enum: Action.options },
      value: { type: "number", description: "Brightness % or temperature °" },
    },
    required: ["target", "action"],
    additionalProperties: false,
  },
  risk: 1,
  timeoutMs: 15_000,
  describe: (i) =>
    i.action === "brightness" ? `Set ${i.target} to ${i.value ?? 50}% brightness` : i.action === "set_temperature" ? `Set ${i.target} to ${i.value}°` : i.action === "activate" ? `Activate the "${i.target}" scene` : `Turn ${i.action === "toggle" ? "over" : i.action} ${i.target}`,
  run: (i, ctx) => control(i, ctx, EVERYDAY),
};

const CoverInput = z.object({ target: z.string().trim().min(2).max(100), action: z.enum(["open", "close", "run"]) }).strict();
const homeCover: ToolDef<z.infer<typeof CoverInput>> = {
  name: "home_cover_or_script",
  description: "Smart home: open/close garage doors, gates and blinds, or run a Home Assistant script. Always needs the owner's approval.",
  input: CoverInput,
  parameters: { type: "object", properties: { target: { type: "string" }, action: { type: "string", enum: ["open", "close", "run"] } }, required: ["target", "action"], additionalProperties: false },
  risk: 2,
  timeoutMs: 15_000,
  describe: (i) => (i.action === "run" ? `Run the Home Assistant script "${i.target}"` : `${i.action === "open" ? "Open" : "Close"} ${i.target}`),
  run: (i, ctx) =>
    i.action === "run" ? control({ target: i.target, action: "on" }, ctx, new Set(["script"])) : control({ target: i.target, action: "on" }, ctx, new Set(["cover"]), i.action),
};

export const HOME_TOOLS: ToolDef[] = [homeDevices, homeControl, homeCover];
