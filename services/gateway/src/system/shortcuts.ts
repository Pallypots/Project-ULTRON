import { execFileSync } from "node:child_process";
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

  private ps(script: string, env: Record<string, string>): string {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...env }, windowsHide: true, timeout: 20_000 }).toString();
  }

  private dirs() {
    if (!this.folders) {
      this.folders = {
        startup: process.env.ULTRON_STARTUP_DIR ?? this.ps(FOLDER, { ULTRON_FOLDER: "Startup" }).trim(),
        desktop: process.env.ULTRON_DESKTOP_DIR ?? this.ps(FOLDER, { ULTRON_FOLDER: "Desktop" }).trim(),
      };
    }
    return this.folders;
  }

  private lnk(kind: "startup" | "desktop") {
    return join(this.dirs()[kind], "ULTRON.lnk");
  }

  state(): ShortcutState {
    if (!this.supported) return { supported: false, startAtLogin: false, desktopShortcut: false };
    return { supported: true, startAtLogin: existsSync(this.lnk("startup")), desktopShortcut: existsSync(this.lnk("desktop")) };
  }

  private create(kind: "startup" | "desktop") {
    this.ps(CREATE, {
      ULTRON_LNK: this.lnk(kind),
      ULTRON_TARGET: join(REPO_ROOT, "Start-ULTRON.bat"),
      // At sign-in, start quietly in the background (minimized); the desktop icon opens the window.
      ULTRON_ARGS: kind === "startup" ? "--background" : "",
      ULTRON_WORKDIR: REPO_ROOT,
      ULTRON_ICON: join(REPO_ROOT, "apps/desktop/public/ultron.ico"),
      ULTRON_WINDOW: kind === "startup" ? "7" : "1",
    });
  }

  setStartAtLogin(enabled: boolean): ShortcutState {
    if (!this.supported) throw new Error("Start at sign-in is only available on Windows.");
    if (enabled) this.create("startup");
    else rmSync(this.lnk("startup"), { force: true });
    return this.state();
  }

  createDesktopShortcut(): ShortcutState {
    if (!this.supported) throw new Error("Desktop shortcuts are only available on Windows.");
    this.create("desktop");
    return this.state();
  }
}
