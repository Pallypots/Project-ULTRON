import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export interface GatewayConfig {
  host: string;
  port: number;
  dataDir: string;
  personaFile: string;
  uiDir: string | null;
  mockDelayMs: number;
  logLevel: string;
}

export function defaultDataDir(): string {
  if (process.env.ULTRON_DATA_DIR) return resolve(process.env.ULTRON_DATA_DIR);
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "ULTRON");
  return join(homedir(), ".ultron");
}

export function loadConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  const envFile = join(REPO_ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const ui = join(REPO_ROOT, "apps/desktop/dist");
  return {
    // Loopback only. Remote access arrives in Phase 5 via Tailscale + device auth, never an open port.
    host: "127.0.0.1",
    port: Number(process.env.ULTRON_PORT ?? 7477),
    dataDir: defaultDataDir(),
    personaFile: process.env.ULTRON_PERSONA_FILE ?? join(REPO_ROOT, "config/persona.json"),
    uiDir: existsSync(join(ui, "index.html")) ? ui : null,
    mockDelayMs: 15,
    logLevel: process.env.ULTRON_LOG_LEVEL ?? "info",
    ...overrides,
  };
}
