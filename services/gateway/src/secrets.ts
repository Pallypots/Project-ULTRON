import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Encrypts/decrypts with Windows DPAPI (bound to the current Windows user). Data goes over stdin, never the command line. */
const DPAPI_SCRIPT = (op: "Protect" | "Unprotect") => `
Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd().Trim()
$entropy = [Text.Encoding]::UTF8.GetBytes('ULTRON-secrets-v2')
$out = [Security.Cryptography.ProtectedData]::${op}([Convert]::FromBase64String($in), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($out))
`;

function dpapi(op: "Protect" | "Unprotect", base64: string): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT(op)], { input: base64, windowsHide: true, timeout: 20_000 }).toString().trim();
}

interface FileV2 {
  v: 2;
  protection: "dpapi" | "file-permissions";
  data: string;
}

export type Protection = FileV2["protection"];

/**
 * Server-side secret storage (API keys, connector tokens). Values are never sent to clients.
 * Windows: encrypted at rest with DPAPI for the current user. Elsewhere: owner-only file permissions (keychain support later).
 */
export class SecretStore {
  private file: string;
  private cache: Record<string, string> = {};
  readonly protection: Protection;
  /** Set when an existing secrets file couldn't be decrypted (e.g. copied from another PC/user). */
  readonly problem: string | null = null;

  constructor(dataDir: string, protection: Protection = process.platform === "win32" && process.env.ULTRON_SECRETS_PLAIN !== "1" ? "dpapi" : "file-permissions") {
    this.file = join(dataDir, "secrets.json");
    this.protection = protection;
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as FileV2 | Record<string, string>;
      if ((parsed as FileV2).v === 2) {
        const f = parsed as FileV2;
        const json = f.protection === "dpapi" ? Buffer.from(dpapi("Unprotect", f.data), "base64").toString("utf8") : Buffer.from(f.data, "base64").toString("utf8");
        this.cache = JSON.parse(json) as Record<string, string>;
        if (f.protection !== this.protection) this.persist(); // upgrade protection
      } else {
        // v1: plain JSON from older versions. Re-save it protected straight away.
        this.cache = parsed as Record<string, string>;
        this.persist();
      }
    } catch {
      // Don't crash and don't delete: keep the unreadable file for the owner and start empty.
      const aside = `${this.file}.unreadable-${Date.now()}`;
      try {
        renameSync(this.file, aside);
      } catch {
        /* ignore */
      }
      this.problem = "Saved API keys/tokens couldn't be decrypted (they were saved by a different Windows user or PC). Please enter them again in Settings.";
      this.cache = {};
    }
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
    this.persist();
  }

  private persist() {
    const b64 = Buffer.from(JSON.stringify(this.cache), "utf8").toString("base64");
    const out: FileV2 = { v: 2, protection: this.protection, data: this.protection === "dpapi" ? dpapi("Protect", b64) : b64 };
    writeFileSync(this.file, JSON.stringify(out), { mode: 0o600 });
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
