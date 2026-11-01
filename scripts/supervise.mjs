// Keeps ULTRON's service running: starts it, and if it ever stops unexpectedly, starts it again (with a short pause).
// Exit code 0 means "the owner chose Quit"; 3 means "already running". Output goes to logs/service.log in the data folder.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dataDir = process.env.ULTRON_DATA_DIR ?? (process.platform === "win32" && process.env.APPDATA ? join(process.env.APPDATA, "ULTRON") : join(homedir(), ".ultron"));
const logs = join(dataDir, "logs");
mkdirSync(logs, { recursive: true });
const logFile = join(logs, "service.log");
try {
  if (statSync(logFile).size > 5e6) renameSync(logFile, join(logs, "service.old.log"));
} catch {}
const log = createWriteStream(logFile, { flags: "a" });
const note = (m) => log.write(`${new Date().toISOString()} [supervisor] ${m}\n`);

let restarts = [];
let child = null;
function start() {
  child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "services/gateway/src/main.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ULTRON_LOG_LEVEL: "warn", ...process.env } });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  if (process.stdout.isTTY) {
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
  }
  child.on("exit", (code, signal) => {
    if (code === 0 || code === 3 || stopping) {
      note(code === 3 ? "already running elsewhere; not starting a second copy" : "stopped");
      process.exit(0);
    }
    const now = Date.now();
    restarts = restarts.filter((t) => now - t < 5 * 60_000);
    restarts.push(now);
    const wait = Math.min(30_000, 1000 * 2 ** (restarts.length - 1));
    note(`service stopped unexpectedly (code ${code ?? signal}); restarting in ${wait / 1000}s`);
    setTimeout(start, wait);
  });
}
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; child?.kill(); });
note("starting");
start();
