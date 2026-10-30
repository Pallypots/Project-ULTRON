// `npm run doctor`: checks this computer is ready to run ULTRON and explains any problem in plain English.
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { cpus, freemem, homedir, platform, release, totalmem } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const results = [];
const check = (name, ok, detail, fix = "") => results.push({ name, ok, detail, fix });
const run = (cmd) => {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
};

const [major, minor] = process.versions.node.split(".").map(Number);
check("Node.js", major > 22 || (major === 22 && minor >= 13), `v${process.versions.node}`, "Install Node.js 22 LTS or newer from https://nodejs.org");
try {
  const { DatabaseSync } = await import("node:sqlite");
  new DatabaseSync(":memory:").exec("CREATE VIRTUAL TABLE t USING fts5(x)");
  check("Built-in database (SQLite + search)", true, "available");
} catch (e) {
  check("Built-in database (SQLite + search)", false, e.message, "Update Node.js to 22.13 or newer");
}
check("Operating system", true, `${platform()} ${release()}${platform() === "win32" ? "" : " (ULTRON targets Windows; other systems work for development)"}`);
check("Memory (RAM)", totalmem() > 4e9, `${(totalmem() / 1e9).toFixed(1)} GB total, ${(freemem() / 1e9).toFixed(1)} GB free, ${cpus().length} CPU threads`, "4 GB+ recommended");
check("Git", Boolean(run("git --version")), run("git --version") ?? "not found", "Optional: install from https://git-scm.com");
check("Dependencies installed", existsSync(join(root, "node_modules")), existsSync(join(root, "node_modules")) ? "yes" : "no", "Run: npm install");
const ui = join(root, "apps/desktop/dist/index.html");
check("Interface built", existsSync(ui), existsSync(ui) ? `built ${statSync(ui).mtime.toLocaleString()}` : "not built yet", "Run: npm run build (the launcher does this for you)");
const dataDir = process.env.ULTRON_DATA_DIR ?? (platform() === "win32" && process.env.APPDATA ? join(process.env.APPDATA, "ULTRON") : join(homedir(), ".ultron"));
check("Data folder", true, dataDir + (existsSync(dataDir) ? "" : " (will be created on first start)"));
const port = Number(process.env.ULTRON_PORT ?? 7477);
const free = await new Promise((r) => {
  const s = createServer().once("error", () => r(false)).once("listening", () => s.close(() => r(true)));
  s.listen(port, "127.0.0.1");
});
const running = !free && (await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.ok).catch(() => false));
check(`Port ${port}`, free || running, free ? "free" : running ? "ULTRON is already running here" : "in use by another program", "Close the other program or set ULTRON_PORT in .env");
const docker = run("docker --version");
check("Docker (optional, later phases)", true, docker ?? "not installed - not needed yet");
const mic = platform() === "win32" ? run('powershell -NoProfile -Command "(Get-PnpDevice -Class AudioEndpoint -Status OK | Where-Object FriendlyName -match \'Microphone\' | Measure-Object).Count"') : null;
check("Microphone (needed for voice, next cycle)", true, mic === null ? "not checked on this OS" : `${mic} microphone(s) detected`);

let bad = 0;
console.log("\nULTRON doctor\n");
for (const r of results) {
  console.log(`${r.ok ? "  ✔" : "  ✖"} ${r.name}: ${r.detail}`);
  if (!r.ok) {
    bad++;
    console.log(`      → ${r.fix}`);
  }
}
console.log(bad ? `\n${bad} problem(s) found. Fix the items marked ✖ and run "npm run doctor" again.\n` : "\nAll good. Start ULTRON with Start-ULTRON.bat (Windows) or `npm start`.\n");
process.exit(bad ? 1 : 0);
