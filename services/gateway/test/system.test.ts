import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectQuickCommand } from "@ultron/agent-core";
import { findApps, listApps, pcStatus } from "../src/actions/system.ts";
import { replyText, startGateway, tmpDataDir } from "./helpers.ts";

const cleanup: (() => Promise<unknown>)[] = [];
let menu = "";
beforeEach(() => {
  menu = mkdtempSync(join(tmpDataDir(), "startmenu-"));
  mkdirSync(join(menu, "Microsoft Office"));
  for (const f of ["Spotify.lnk", "Uninstall Spotify.lnk", "Notepad.lnk", "Visual Studio Code.lnk", "Microsoft Office/Microsoft Word.lnk", "Steam Support Center.url", "Steam.url", "readme.txt"])
    writeFileSync(join(menu, f), "");
  process.env.ULTRON_START_MENU_DIRS = menu;
  process.env.ULTRON_ACTIONS_DRY_RUN = "1";
});
afterEach(async () => {
  delete process.env.ULTRON_START_MENU_DIRS;
  delete process.env.ULTRON_ACTIONS_DRY_RUN;
  while (cleanup.length) await cleanup.pop()!();
});
const gateway = async () => {
  const g = await startGateway();
  cleanup.push(g.close);
  return g;
};
const tool = (events: any[]) => events.find((e) => e.type === "tool")?.event;

describe("opening apps", () => {
  it("knows installed apps from the Start menu, skipping uninstallers and non-shortcuts", () => {
    expect(listApps().map((a) => a.name)).toEqual(["Microsoft Word", "Notepad", "Spotify", "Steam", "Visual Studio Code"]);
    expect(findApps("spotify").map((a) => a.name)).toEqual(["Spotify"]);
    expect(findApps("word")[0]!.name).toBe("Microsoft Word");
    expect(findApps("visual studio")[0]!.name).toBe("Visual Studio Code");
    expect(findApps("vsc")[0]!.name).toBe("Visual Studio Code");
    expect(findApps("photoshop")).toEqual([]);
  });

  it("asks before opening, shows exactly which app, and only treats real apps as a quick command", async () => {
    const g = await gateway();
    const id = await g.newConversation();
    const events = await g.chat(id, "open spotify");
    expect(tool(events)).toMatchObject({ tool: "open_app", status: "awaiting_approval", risk: 2, summary: 'Open the app "Spotify"' });
    expect(tool(events).preview).toContain(join(menu, "Spotify.lnk"));
    expect(replyText(events)).toMatch(/needs your OK/);
    const approved = await g.api("POST", `/api/actions/${tool(events).executionId}/approve`);
    expect(approved.body.action).toMatchObject({ status: "succeeded" });
    expect(approved.body.action.result).toContain('"opened":"Spotify"');
    // Not an installed app: the brain gets it instead (the test brain just echoes).
    expect(replyText(await g.chat(id, "open the pod bay doors"))).toMatch(/Offline mock mode/);
    expect(replyText(await g.chat(id, "open photoshop"))).toMatch(/Offline mock mode/);
  });
});

describe("media and volume", () => {
  it("parses everyday media commands", () => {
    expect(detectQuickCommand("pause the music")).toEqual({ type: "media", action: "play_pause" });
    expect(detectQuickCommand("Ultron, next song")).toEqual({ type: "media", action: "next" });
    expect(detectQuickCommand("skip this")).toEqual({ type: "media", action: "next" });
    expect(detectQuickCommand("turn it up a lot")).toEqual({ type: "media", action: "volume_up", steps: 12 });
    expect(detectQuickCommand("quieter")).toEqual({ type: "media", action: "volume_down", steps: 5 });
    expect(detectQuickCommand("mute")).toEqual({ type: "media", action: "mute" });
    expect(detectQuickCommand("play some jazz")).toBeNull();
  });

  it("runs straight away (low risk, logged) on Windows and says plainly when it can't", async () => {
    const g = await gateway();
    const events = await g.chat(await g.newConversation(), "turn the volume up");
    if (process.platform === "win32") {
      expect(tool(events)).toMatchObject({ tool: "media_control", status: "succeeded", risk: 1 });
      expect(replyText(events)).toBe("Turned it up.");
    } else {
      expect(tool(events)).toMatchObject({ tool: "media_control", status: "failed" });
      expect(replyText(events)).toMatch(/Windows only/);
    }
  });
});

describe("PC status", () => {
  it("reports memory, disk and uptime", async () => {
    const s = await pcStatus();
    expect(s.memory.used_percent).toBeGreaterThan(0);
    expect(s.disk?.free).toMatch(/GB$/);
    expect(s.up_for).toMatch(/h|days/);
  }, 20_000);
});

describe.skipIf(process.platform !== "win32")("on real Windows", () => {
  it("lists real Start-menu apps, reads PC status, and sends media keys", async () => {
    delete process.env.ULTRON_START_MENU_DIRS;
    delete process.env.ULTRON_ACTIONS_DRY_RUN;
    const { toolByName } = await import("../src/actions/tools.ts");
    const apps = listApps();
    const status = await pcStatus();
    const media = toolByName("media_control")!;
    const ctx = { dryRun: false } as never;
    // Mute twice: proves the keys are sent without leaving the machine muted.
    const a = JSON.parse(await media.run({ action: "mute" }, ctx));
    const b = JSON.parse(await media.run({ action: "mute" }, ctx));
    expect(a.ok && b.ok).toBe(true);
    const { ciNote } = await import("./helpers.ts");
    ciNote("Windows PC control", `apps=${apps.length} e.g. ${apps.slice(0, 6).map((x) => x.name).join(", ")} | notepad=${findApps("notepad")[0]?.name ?? "none"} | memory ${status.memory.used}/${status.memory.total} | disk free ${status.disk?.free} | battery ${JSON.stringify(status.battery)} | media keys sent`);
    expect(apps.length).toBeGreaterThan(0);
  }, 60_000);
});
