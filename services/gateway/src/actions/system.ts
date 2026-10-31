import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { delimiter, join, parse } from "node:path";
import { z } from "zod";
import type { ToolDef } from "./tools.ts";

const isWindows = () => process.platform === "win32";

/** Runs a fixed PowerShell script; values travel in environment variables, never spliced into the script. */
function ps(script: string, env: Record<string, string> = {}, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...env }, windowsHide: true, timeout: timeoutMs }, (err, out) =>
      err ? reject(new Error("Windows didn't complete that.")) : resolve(String(out)),
    );
  });
}

// ---- Media and volume ----------------------------------------------------------------------------------------

// Windows virtual-key codes for the media keys every keyboard driver understands.
const MEDIA_KEYS = { play_pause: 0xb3, next: 0xb0, previous: 0xb1, mute: 0xad, volume_down: 0xae, volume_up: 0xaf } as const;
type MediaAction = keyof typeof MEDIA_KEYS;
const SEND_KEY = `$w = New-Object -ComObject WScript.Shell; for ($i = 0; $i -lt [int]$env:ULTRON_N; $i++) { $w.SendKeys([string][char][int]$env:ULTRON_KEY) }`;
const MEDIA_WORDS: Record<MediaAction, string> = {
  play_pause: "Play/pause",
  next: "Next track",
  previous: "Previous track",
  mute: "Mute/unmute",
  volume_down: "Volume down",
  volume_up: "Volume up",
};

const media: ToolDef<{ action: MediaAction; steps?: number }> = {
  name: "media_control",
  description:
    "Control whatever is playing on the owner's PC like the keyboard's media keys: play/pause, next, previous, mute, volume up/down (steps of about 2% each; 5 steps ≈ 10%). Works with Spotify, YouTube in the browser, etc.",
  input: z.object({ action: z.enum(["play_pause", "next", "previous", "mute", "volume_up", "volume_down"]), steps: z.number().int().min(1).max(25).optional() }).strict(),
  parameters: {
    type: "object",
    properties: { action: { type: "string", enum: Object.keys(MEDIA_KEYS) }, steps: { type: "integer", description: "For volume: how many steps (default 5)" } },
    required: ["action"],
    additionalProperties: false,
  },
  risk: 1,
  timeoutMs: 12_000,
  describe: (i) => `${MEDIA_WORDS[i.action]}${i.action.startsWith("volume") ? ` (${i.steps ?? 5} steps)` : ""}`,
  run: async (i, ctx) => {
    if (!isWindows()) throw new Error("Media and volume control works on Windows only.");
    const n = i.action.startsWith("volume") ? (i.steps ?? 5) : 1;
    if (!ctx.dryRun) await ps(SEND_KEY, { ULTRON_KEY: String(MEDIA_KEYS[i.action]), ULTRON_N: String(n) });
    return JSON.stringify({ ok: true, did: MEDIA_WORDS[i.action], steps: n, dryRun: ctx.dryRun || undefined });
  },
};

// ---- Opening apps from the Start menu --------------------------------------------------------------------------

export interface AppEntry {
  name: string;
  path: string;
}

/** Start-menu folders (all users + this user). Overridable for tests. */
export function startMenuDirs(): string[] {
  if (process.env.ULTRON_START_MENU_DIRS) return process.env.ULTRON_START_MENU_DIRS.split(delimiter).filter(Boolean);
  if (!isWindows()) return [];
  return [
    process.env.ProgramData && join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"),
    process.env.APPDATA && join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs"),
  ].filter((d): d is string => Boolean(d));
}

const JUNK = /\b(uninstall|uninst|remove|readme|read me|help|manual|documentation|license|release notes|website|support|changelog|what'?s new)\b/i;

/** Apps the owner has installed, as listed in the Start menu (shortcuts only; nothing outside these folders is ever run). */
export function listApps(dirs = startMenuDirs()): AppEntry[] {
  const out: AppEntry[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth < 3) walk(p, depth + 1);
      } else if (/\.(lnk|url)$/i.test(e)) {
        const name = parse(e).name;
        if (!JUNK.test(name)) out.push({ name, path: p });
      }
    }
  };
  for (const d of dirs) walk(d, 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Best Start-menu matches for what the owner called the app ("spotify", "word", "vs code"). */
export function findApps(query: string, apps = listApps()): AppEntry[] {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(" ");
  const scored = apps
    .map((a) => {
      const n = norm(a.name);
      const initials = n.split(" ").map((w) => w[0]).join("");
      const score = n === q ? 100 : n.startsWith(q) ? 80 : words.every((w) => n.split(" ").some((x) => x.startsWith(w))) ? 60 : initials === q.replace(/ /g, "") ? 50 : n.includes(q) ? 40 : 0;
      return { a, score: score ? score - n.length / 100 : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  // Same app in both Start-menu folders: keep one.
  const seen = new Set<string>();
  return scored.map((x) => x.a).filter((a) => (seen.has(a.name.toLowerCase()) ? false : (seen.add(a.name.toLowerCase()), true)));
}

/** True only for a shortcut file inside one of the Start-menu folders. */
function isStartMenuShortcut(path: string): boolean {
  const lower = path.toLowerCase();
  return /\.(lnk|url)$/i.test(path) && startMenuDirs().some((d) => lower.startsWith(d.toLowerCase().replace(/[\\/]+$/, "") + (isWindows() ? "\\" : "/")));
}

const launchApp: ToolDef<{ app: string }> = {
  name: "open_app",
  description:
    "Open an app installed on the owner's PC by its name as it appears in the Start menu (e.g. 'Spotify', 'Notepad', 'Visual Studio Code'). Needs the owner's approval each time. If several apps match, the best match is shown on the approval card.",
  input: z.object({ app: z.string().trim().min(1).max(80) }).strict(),
  parameters: { type: "object", properties: { app: { type: "string", description: "App name, e.g. 'Spotify'" } }, required: ["app"], additionalProperties: false },
  risk: 2,
  timeoutMs: 15_000,
  describe: (i) => {
    const hit = findApps(i.app)[0];
    return hit ? `Open the app "${hit.name}"` : `Open an app called "${i.app}" (not found in your Start menu)`;
  },
  preview: (i) => {
    const hits = findApps(i.app);
    if (!hits.length) return `No app called "${i.app}" was found in your Start menu, so approving will do nothing.`;
    return `Will open: ${hits[0]!.name}\nFrom your Start menu: ${hits[0]!.path}${hits.length > 1 ? `\n(Other matches: ${hits.slice(1, 4).map((h) => h.name).join(", ")})` : ""}`;
  },
  run: async (i, ctx) => {
    if (!isWindows() && !process.env.ULTRON_START_MENU_DIRS) throw new Error("Opening apps works on Windows only.");
    const hit = findApps(i.app)[0];
    if (!hit) return JSON.stringify({ ok: false, note: `No app called "${i.app}" in the Start menu.`, some_installed_apps: listApps().slice(0, 30).map((a) => a.name) });
    if (!isStartMenuShortcut(hit.path) || !existsSync(hit.path)) throw new Error("That shortcut isn't in the Start menu any more.");
    if (!ctx.dryRun) {
      await new Promise<void>((resolve, reject) =>
        execFile("explorer.exe", [hit.path], { windowsHide: true, timeout: 10_000 }, (err) =>
          // explorer.exe exits with 1 even on success.
          err && (err as { code?: number }).code !== 1 ? reject(new Error("Windows couldn't open it.")) : resolve(),
        ),
      );
    }
    return JSON.stringify({ ok: true, opened: hit.name, dryRun: ctx.dryRun || undefined });
  },
};

const findAppsTool: ToolDef<{ query?: string }> = {
  name: "find_apps",
  description: "List apps installed on the owner's PC (from the Start menu), optionally filtered, e.g. to check what's installed before opening one.",
  input: z.object({ query: z.string().trim().max(80).optional() }).strict(),
  parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
  risk: 0,
  timeoutMs: 5000,
  describe: (i) => (i.query ? `Look for apps matching "${i.query}"` : "List your installed apps"),
  run: async (i) => {
    const apps = i.query ? findApps(i.query) : listApps();
    if (!startMenuDirs().length) return JSON.stringify({ apps: [], note: "App listing works on Windows only." });
    return JSON.stringify({ count: apps.length, apps: apps.slice(0, 60).map((a) => a.name) });
  },
};

// ---- How the PC is doing -------------------------------------------------------------------------------------

const BATTERY_PS = `$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; if ($b) { [Console]::Out.Write((@{ percent = $b.EstimatedChargeRemaining; status = $b.BatteryStatus } | ConvertTo-Json -Compress)) }`;

async function battery(): Promise<{ percent: number; charging: boolean } | null> {
  try {
    if (isWindows()) {
      const raw = (await ps(BATTERY_PS, {}, 8000)).trim();
      if (!raw) return null;
      const b = JSON.parse(raw) as { percent: number; status: number };
      return { percent: b.percent, charging: [2, 6, 7, 8, 9].includes(b.status) };
    }
    const dir = "/sys/class/power_supply";
    const bat = existsSync(dir) ? readdirSync(dir).find((d) => d.startsWith("BAT")) : undefined;
    if (!bat) return null;
    return { percent: Number(readFileSync(join(dir, bat, "capacity"), "utf8")), charging: /charging|full/i.test(readFileSync(join(dir, bat, "status"), "utf8")) };
  } catch {
    return null;
  }
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

export async function pcStatus() {
  const drive = isWindows() ? (process.env.SystemDrive ?? "C:") + "\\" : "/";
  const disk = await statfs(drive).catch(() => null);
  const total = os.totalmem();
  const free = os.freemem();
  const up = os.uptime();
  return {
    computer: os.hostname(),
    system: `${os.type()} ${os.release()}`,
    cpu: `${os.cpus()[0]?.model.trim() ?? "unknown"} (${os.cpus().length} threads)`,
    memory: { used: gb(total - free), total: gb(total), used_percent: Math.round(((total - free) / total) * 100) },
    disk: disk ? { drive, free: gb(disk.bavail * disk.bsize), total: gb(disk.blocks * disk.bsize), used_percent: Math.round((1 - disk.bavail / disk.blocks) * 100) } : null,
    battery: (await battery()) ?? "no battery (desktop) or not readable",
    up_for: up > 86_400 ? `${Math.floor(up / 86_400)} days ${Math.floor((up % 86_400) / 3600)} h` : `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min`,
  };
}

const status: ToolDef<Record<string, never>> = {
  name: "pc_status",
  description: "How the owner's computer is doing: memory and disk use, battery, uptime, CPU. For 'how's my PC?', 'am I running out of space?', 'how much battery?'.",
  input: z.object({}).strict(),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  risk: 0,
  timeoutMs: 12_000,
  describe: () => "Check how your PC is doing",
  run: async () => JSON.stringify(await pcStatus()),
};

export const SYSTEM_TOOLS: ToolDef[] = [media, launchApp, findAppsTool, status];
