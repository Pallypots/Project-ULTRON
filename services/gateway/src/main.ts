import { buildGateway } from "./app.ts";

const { app, config } = await buildGateway();
try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`\n  ULTRON is online at http://localhost:${config.port}\n  Data folder: ${config.dataDir}\n  Press Ctrl+C to stop.\n`);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. ULTRON may already be running: open http://localhost:${config.port}`);
  } else console.error(err);
  process.exit(1);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
