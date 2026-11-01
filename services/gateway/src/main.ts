import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildGateway } from "./app.ts";
import { defaultDataDir } from "./config.ts";

// Safety net: one stray error in background work (a page watcher, a slow service, a model warming up) must never take
// the whole assistant down. It's written to logs/crash.log for diagnosis and ULTRON keeps running.
const crashLog = (kind: string, err: unknown) => {
  const line = `${new Date().toISOString()} ${kind}: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`;
  console.error(line);
  try {
    const dir = join(defaultDataDir(), "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "crash.log"), line);
  } catch {
    /* logging must never throw */
  }
};
process.on("unhandledRejection", (err) => crashLog("unhandled rejection", err));
// An uncaught exception can leave things half-done: log it and exit, and the supervisor restarts ULTRON cleanly.
process.on("uncaughtException", (err) => {
  crashLog("uncaught exception", err);
  process.exit(1);
});

const { app, config } = await buildGateway();
try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`\n  ULTRON is online at http://localhost:${config.port}\n  Data folder: ${config.dataDir}\n  Press Ctrl+C to stop.\n`);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. ULTRON may already be running: open http://localhost:${config.port}`);
    process.exit(3); // tells the supervisor not to retry
  } else console.error(err);
  process.exit(1);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
