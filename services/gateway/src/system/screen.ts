import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

// Primary screen, DPI-aware (so it isn't cropped on scaled displays), shrunk to at most 1600 px and saved as JPEG.
const CAPTURE = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class UltronDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[UltronDpi]::SetProcessDPIAware() | Out-Null
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$scale = [Math]::Min(1.0, 1600 / [Math]::Max($b.Width, $b.Height))
$small = New-Object System.Drawing.Bitmap $bmp, ([int]($b.Width * $scale)), ([int]($b.Height * $scale))
$small.Save($env:ULTRON_SHOT, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose(); $bmp.Dispose(); $small.Dispose()
`;

export class ScreenError extends Error {}

/** True when the owner is asking ULTRON to look at their screen (only the owner's own words can trigger this). */
export function wantsScreen(text: string): boolean {
  return /\b(look(?:ing)? at|check|read|see|what'?s on|what is on|describe|scan|glance at)\b[^.?!]{0,30}\b(my|the|this)\s+(screen|display|monitor)\b|\bwhat am i looking at\b|\bcan you see (?:my|the) screen\b|\btake a screenshot\b/i.test(text);
}

/** One screenshot of the primary screen as base64 JPEG. Never written anywhere except a temp file that's deleted at once. */
export async function captureScreen(dataDir: string): Promise<string> {
  if (process.env.ULTRON_FAKE_SCREENSHOT) return (await readFile(process.env.ULTRON_FAKE_SCREENSHOT)).toString("base64"); // tests
  if (process.platform !== "win32") throw new ScreenError("Looking at the screen works on Windows only for now.");
  const file = join(dataDir, `screen-${process.pid}-${Date.now()}.jpg`);
  try {
    await new Promise<void>((resolve, reject) =>
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", CAPTURE], { env: { ...process.env, ULTRON_SHOT: file }, windowsHide: true, timeout: 20_000 }, (err) =>
        err ? reject(new ScreenError("Windows didn't let ULTRON capture the screen.")) : resolve(),
      ),
    );
    return (await readFile(file)).toString("base64");
  } finally {
    await rm(file, { force: true }).catch(() => {});
  }
}
