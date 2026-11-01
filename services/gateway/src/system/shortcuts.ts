import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../config.ts";

// Paths are passed through environment variables, never spliced into the script (no injection via odd folder names).
const CREATE = `
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:ULTRON_LNK)
$s.TargetPath = $env:ULTRON_TARGET
$s.Arguments = $env:ULTRON_ARGS
$s.WorkingDirectory = $env:ULTRON_WORKDIR
$s.IconLocation = $env:ULTRON_ICON
$s.WindowStyle = [int]$env:ULTRON_WINDOW
$s.Description = 'ULTRON personal assistant'
$s.Save()
`;
const TARGET = `[Console]::Out.Write((New-Object -ComObject WScript.Shell).CreateShortcut($env:ULTRON_LNK).TargetPath)`;
const FOLDER = `[Console]::Out.Write([Environment]::GetFolderPath($env:ULTRON_FOLDER))`;

export interface ShortcutState {
  supported: boolean;
  startAtLogin: boolean;
  desktopShortcut: boolean;
}

/** Windows conveniences: desktop shortcut and start-at-sign-in (a shortcut in the Startup folder). */
export class Shortcuts {
  private folders: { startup: string; desktop: string } | null = null;
  readonly supported = process.platform === "win32";

  // Asynchronous on purpose: PowerShell can take seconds to start on a busy PC, and the whole service must stay responsive.
  private ps(script: string, env: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) =>
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...env }, windowsHide: true, timeout: 20_000 }, (err, out) => (err ? reject(err) : resolve(String(out)))),
    );
  }

  private async dirs() {
    if (!this.folders) {
      this.folders = {
        startup: process.env.ULTRON_STARTUP_DIR ?? (await this.ps(FOLDER, { ULTRON_FOLDER: "Startup" })).trim(),
        desktop: process.env.ULTRON_DESKTOP_DIR ?? (await this.ps(FOLDER, { ULTRON_FOLDER: "Desktop" })).trim(),
      };
    }
    return this.folders;
  }

  private async lnk(kind: "startup" | "desktop") {
    return join((await this.dirs())[kind], "ULTRON.lnk");
  }

  async state(): Promise<ShortcutState> {
    if (!this.supported) return { supported: false, startAtLogin: false, desktopShortcut: false };
    return { supported: true, startAtLogin: existsSync(await this.lnk("startup")), desktopShortcut: existsSync(await this.lnk("desktop")) };
  }

  private async create(kind: "startup" | "desktop") {
    await this.ps(CREATE, {
      ULTRON_LNK: await this.lnk(kind),
      ULTRON_TARGET: join(REPO_ROOT, "Start-ULTRON.bat"),
      // At sign-in, start quietly in the background (minimized); the desktop icon opens the window.
      ULTRON_ARGS: kind === "startup" ? "--background" : "",
      ULTRON_WORKDIR: REPO_ROOT,
      ULTRON_ICON: join(REPO_ROOT, "apps/desktop/public/ultron.ico"),
      ULTRON_WINDOW: kind === "startup" ? "7" : "1",
    });
  }

  /**
   * Shortcuts made by an older download point at that old folder, so signing in to Windows would start the OLD ULTRON.
   * If an existing shortcut points somewhere else, point it at this copy.
   */
  async repoint(): Promise<string[]> {
    if (!this.supported) return [];
    const fixed: string[] = [];
    const want = join(REPO_ROOT, "Start-ULTRON.bat").toLowerCase();
    for (const kind of ["startup", "desktop"] as const) {
      const lnk = await this.lnk(kind);
      if (!existsSync(lnk)) continue;
      const target = (await this.ps(TARGET, { ULTRON_LNK: lnk }).catch(() => "")).trim().toLowerCase();
      if (target && target !== want) {
        await this.create(kind);
        fixed.push(kind);
      }
    }
    return fixed;
  }

  async setStartAtLogin(enabled: boolean): Promise<ShortcutState> {
    if (!this.supported) throw new Error("Start at sign-in is only available on Windows.");
    if (enabled) await this.create("startup");
    else rmSync(await this.lnk("startup"), { force: true });
    return this.state();
  }

  async createDesktopShortcut(): Promise<ShortcutState> {
    if (!this.supported) throw new Error("Desktop shortcuts are only available on Windows.");
    await this.create("desktop");
    return this.state();
  }
}
