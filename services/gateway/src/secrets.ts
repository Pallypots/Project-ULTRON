import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-side secret storage. Values are never sent to clients.
 * Current implementation: a JSON file in the owner's data directory with owner-only permissions.
 * Planned (see SECURITY.md): Windows DPAPI / OS keychain.
 */
export class SecretStore {
  private file: string;
  private cache: Record<string, string>;

  constructor(dataDir: string) {
    this.file = join(dataDir, "secrets.json");
    this.cache = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Record<string, string>) : {};
  }

  get(name: string): string | undefined {
    return this.cache[name] || process.env[name] || undefined;
  }

  has(name: string): boolean {
    return Boolean(this.get(name));
  }

  set(name: string, value: string | null): void {
    if (value) this.cache[name] = value;
    else delete this.cache[name];
    writeFileSync(this.file, JSON.stringify(this.cache, null, 2), { mode: 0o600 });
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* best effort on Windows */
    }
  }

  /** All secret values, so the logger can scrub them. */
  values(): string[] {
    return Object.values(this.cache).filter((v) => v.length >= 6);
  }
}
