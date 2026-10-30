// Runs the gateway (auto-restarts on change) and the Vite UI dev server together.
import { spawn } from "node:child_process";

const procs = [
  spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "--watch", "services/gateway/src/main.ts"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "@ultron/desktop"], { stdio: "inherit", shell: true }),
];
console.log("\n  ULTRON dev: UI at http://localhost:5173 (API on :7477)\n");
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => code && code !== 0 && stop());
