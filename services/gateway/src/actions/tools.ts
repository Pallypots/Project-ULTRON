import { execFile } from "node:child_process";
import { z } from "zod";
import type { Stores } from "@ultron/memory";

/**
 * Risk levels (blueprint §7):
 * L0 read-only · L1 reversible, low-risk (e.g. a timer) · L2 external effect or durable change (needs approval) · L3 financial/destructive (blocked)
 */
export type Risk = 0 | 1 | 2 | 3;

export interface ToolContext {
  stores: Stores;
  conversationId: string | null;
  dryRun: boolean;
  now: () => Date;
}

export interface ToolDef<I = any> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  /** JSON Schema shown to the model (kept in sync with `input` by hand; `input` is what's enforced). */
  parameters: Record<string, unknown>;
  risk: Risk;
  timeoutMs: number;
  /** Plain-English preview of exactly what will happen, shown before approval. */
  describe(input: I): string;
  run(input: I, ctx: ToolContext): Promise<string>;
}

export function humanSpan(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 48) return `in ${h} hour${h === 1 ? "" : "s"}${rest ? ` ${rest} min` : ""}`;
  return `in ${Math.round(h / 24)} days`;
}

const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmtLocal = (d: Date) => d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const getTime: ToolDef<Record<string, never>> = {
  name: "get_current_time",
  description: "Get the current local date, time and time zone on the owner's computer.",
  input: z.object({}).strict(),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  risk: 0,
  timeoutMs: 1000,
  describe: () => "Check the current date and time",
  run: async (_i, ctx) => {
    const now = ctx.now();
    return JSON.stringify({ local: now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }), iso: now.toISOString(), timeZone: localTimeZone() });
  },
};

const CreateReminder = z
  .object({
    text: z.string().trim().min(1).max(300),
    minutes_from_now: z.number().positive().max(60 * 24 * 365).optional(),
    at_local_time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, "use YYYY-MM-DDTHH:MM in local time")
      .optional(),
  })
  .strict()
  .refine((v) => (v.minutes_from_now === undefined) !== (v.at_local_time === undefined), "Give exactly one of minutes_from_now or at_local_time.");

const createReminder: ToolDef<z.infer<typeof CreateReminder>> = {
  name: "create_reminder",
  description: "Schedule a reminder that pops up (and is spoken) on the owner's computer at a given time. Use minutes_from_now for relative times or at_local_time (YYYY-MM-DDTHH:MM, owner's local time) for clock times.",
  input: CreateReminder,
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "What to remind the owner about, phrased for them, e.g. 'call mom'." },
      minutes_from_now: { type: "number", description: "Minutes from now. Use this OR at_local_time." },
      at_local_time: { type: "string", description: "Local date and time, format YYYY-MM-DDTHH:MM. Use this OR minutes_from_now." },
    },
    required: ["text"],
    additionalProperties: false,
  },
  risk: 1,
  timeoutMs: 2000,
  describe: (i) => {
    if (i.minutes_from_now === undefined) return `Set a reminder: "${i.text}" at ${fmtLocal(new Date(i.at_local_time!.replace(" ", "T")))}`;
    const due = new Date(Date.now() + i.minutes_from_now * 60_000);
    return `Set a reminder: "${i.text}" ${humanSpan(i.minutes_from_now * 60_000)} (${due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })})`;
  },
  run: async (i, ctx) => {
    const due = i.minutes_from_now !== undefined ? new Date(ctx.now().getTime() + i.minutes_from_now * 60_000) : new Date(i.at_local_time!.replace(" ", "T"));
    if (Number.isNaN(due.getTime())) throw new Error("That time couldn't be understood.");
    if (due.getTime() < ctx.now().getTime() - 60_000) throw new Error("That time is in the past.");
    const r = ctx.stores.reminders.create({ text: i.text, dueAt: due, source: "tool", conversationId: ctx.conversationId });
    return JSON.stringify({ ok: true, reminder_id: r.id, text: r.text, due_local: fmtLocal(due) });
  },
};

const listReminders: ToolDef<Record<string, never>> = {
  name: "list_reminders",
  description: "List the owner's upcoming reminders and any missed while ULTRON was off.",
  input: z.object({}).strict(),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  risk: 0,
  timeoutMs: 1000,
  describe: () => "Read your reminders",
  run: async (_i, ctx) => {
    const all = ctx.stores.reminders.list().filter((r) => r.status === "scheduled" || r.status === "missed");
    return JSON.stringify(all.slice(0, 20).map((r) => ({ id: r.id, text: r.text, when: fmtLocal(new Date(r.dueAt)), status: r.status })));
  },
};

const cancelReminder: ToolDef<{ reminder_id: string }> = {
  name: "cancel_reminder",
  description: "Cancel one upcoming reminder by its id (get ids from list_reminders).",
  input: z.object({ reminder_id: z.string().min(1).max(64) }).strict(),
  parameters: { type: "object", properties: { reminder_id: { type: "string" } }, required: ["reminder_id"], additionalProperties: false },
  risk: 1,
  timeoutMs: 1000,
  describe: (i) => `Cancel reminder ${i.reminder_id.slice(0, 8)}`,
  run: async (i, ctx) => {
    const r = ctx.stores.reminders.get(i.reminder_id);
    if (!r || r.status !== "scheduled") throw new Error("No upcoming reminder with that id.");
    ctx.stores.reminders.setStatus(r.id, "cancelled");
    return JSON.stringify({ ok: true, cancelled: r.text });
  },
};

const OpenWebsite = z.object({
  url: z
    .string()
    .max(2000)
    .refine((u) => {
      try {
        const p = new URL(u);
        return (p.protocol === "https:" || p.protocol === "http:") && !p.username && !p.password;
      } catch {
        return false;
      }
    }, "Only plain http(s) web addresses can be opened."),
});

/** Opens a URL in the owner's default browser without a shell (no command injection possible). */
function launchBrowser(url: string): Promise<void> {
  const [cmd, args] = process.platform === "win32" ? ["explorer.exe", [url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { windowsHide: true, timeout: 10_000 }, (err) => {
      // explorer.exe exits with code 1 even on success.
      if (err && !(process.platform === "win32" && (err as { code?: number }).code === 1)) reject(new Error("Couldn't open the browser on this computer."));
      else resolve();
    });
    child.unref();
  });
}

const openWebsite: ToolDef<z.infer<typeof OpenWebsite>> = {
  name: "open_website",
  description: "Open a web page in the owner's default browser on their computer. Requires the owner's approval each time.",
  input: OpenWebsite,
  parameters: { type: "object", properties: { url: { type: "string", description: "Full http(s) URL." } }, required: ["url"], additionalProperties: false },
  risk: 2,
  timeoutMs: 15_000,
  describe: (i) => `Open ${new URL(i.url).host} in your browser (${i.url})`,
  run: async (i, ctx) => {
    if (!ctx.dryRun) await launchBrowser(i.url);
    return JSON.stringify({ ok: true, opened: i.url, dryRun: ctx.dryRun || undefined });
  },
};

export const TOOLS: ToolDef[] = [getTime, createReminder, listReminders, cancelReminder, openWebsite];
export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);
