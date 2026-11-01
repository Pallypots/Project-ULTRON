import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import type { FastifyRequest } from "fastify";
import type { Device, Stores } from "@ultron/memory";

/**
 * Phone access over Tailscale (blueprint Phase 5). ULTRON itself still listens only on this computer; the owner runs
 * `tailscale serve`, which gives the PC a private HTTPS address on their tailnet and forwards it to ULTRON locally.
 * Requests for that address are "remote": they never get the PC's session key, only a per-device key obtained by pairing
 * with a short code shown on the PC screen, and some settings stay PC-only.
 */
export interface RemoteSettings {
  enabled: boolean;
  /** The PC's tailnet address, e.g. "my-pc.tail1234.ts.net". */
  host: string;
}

const PAIR_TTL_MS = 5 * 60_000;
const PAIR_MAX_ATTEMPTS = 5; // per person (Tailscale tells us who), so someone else on the tailnet can't lock the owner out
const PAIR_MAX_TOTAL = 20; // overall cap: guessing stays hopeless (20 in a million)
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Changing keys, folders, connections, other devices or exporting everything stays on the PC itself. */
export function isPcOnly(method: string, path: string): boolean {
  if (/^\/api\/(remote|logs\/export|memories\/export)(\/|$)/.test(path)) return true;
  if (method === "GET" || method === "HEAD") return false;
  // Anything that adds credentials, widens access, sends audio to the cloud, or acts on the PC's screen stays on the PC.
  return /^\/api\/(settings\/(provider|search|checkin)|connectors\/github|files\/(folders|open)|system\/|local-ai\/(pull|use)|persona|calendar|home|email|voice\/(settings|tts\/settings|room)|routines)(\/|$)/.test(path);
}

export class RemoteAccess {
  private pairing: { code: string; expiresAt: number; attempts: number; byWho: Map<string, number> } | null = null;
  private lastTouch = new Map<string, number>();

  constructor(private stores: Stores) {}

  settings(): RemoteSettings {
    return this.stores.preferences.get<RemoteSettings>("remote_access", { enabled: false, host: "" });
  }

  save(next: RemoteSettings): RemoteSettings {
    const host = next.host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/.]+$/, "");
    if (next.enabled && !HOST_RE.test(host)) throw new Error('Enter your PC\'s Tailscale address, like "my-pc.tail1234.ts.net".');
    if (host && /^(localhost|127\.|\[?::1)/.test(host)) throw new Error("That's this computer's own address; use its Tailscale address.");
    const s = { enabled: next.enabled, host };
    this.stores.preferences.set("remote_access", s);
    if (!s.enabled) this.pairing = null;
    return s;
  }

  /** A request addressed to the configured tailnet name (and, if it has an Origin, coming from that same HTTPS site). */
  isRemote(req: FastifyRequest): boolean {
    const s = this.settings();
    if (!s.enabled || !s.host) return false;
    const host = (req.headers.host ?? "").toLowerCase().replace(/:443$/, "");
    if (host !== s.host) return false;
    const origin = req.headers.origin?.toLowerCase();
    return !origin || origin === `https://${s.host}`;
  }

  /** The paired device presenting this key, if it's valid and not revoked. */
  device(authorization: string | undefined): Device | null {
    if (!authorization?.startsWith("Bearer ")) return null;
    const d = this.stores.devices.active(hashToken(authorization.slice(7)));
    if (d && Date.now() - (this.lastTouch.get(d.id) ?? 0) > 60_000) {
      this.lastTouch.set(d.id, Date.now());
      this.stores.devices.touch(d.id);
    }
    return d;
  }

  /** Starts pairing: a 6-digit code shown on the PC, valid for 5 minutes and 5 attempts. */
  startPairing(): { code: string; expiresAt: string } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pairing = { code, expiresAt: Date.now() + PAIR_TTL_MS, attempts: 0, byWho: new Map() };
    return { code, expiresAt: new Date(this.pairing.expiresAt).toISOString() };
  }

  pairingActive(): boolean {
    return Boolean(this.pairing && Date.now() < this.pairing.expiresAt);
  }

  /** Exchanges the code for a new device key (shown once). Wrong codes count; too many ends the pairing. */
  claim(code: string, name: string, who = "unknown"): { ok: true; token: string; device: Device } | { ok: false; reason: string } {
    const p = this.pairing;
    if (!p || Date.now() >= p.expiresAt) return { ok: false, reason: "No pairing is open. On your PC, go to Settings → Phone access → Pair a phone." };
    if ((p.byWho.get(who) ?? 0) >= PAIR_MAX_ATTEMPTS) return { ok: false, reason: "Too many wrong codes. Start pairing again on your PC." };
    const a = Buffer.from(code.trim());
    const b = Buffer.from(p.code);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      p.byWho.set(who, (p.byWho.get(who) ?? 0) + 1);
      if (++p.attempts >= PAIR_MAX_TOTAL) this.pairing = null;
      return { ok: false, reason: this.pairing && (p.byWho.get(who) ?? 0) < PAIR_MAX_ATTEMPTS ? "That code isn't right. Check the code on your PC screen." : "Too many wrong codes. Start pairing again on your PC." };
    }
    this.pairing = null; // one device per code
    const token = randomBytes(32).toString("base64url");
    const device = this.stores.devices.create(name.trim().slice(0, 40) || "Phone", hashToken(token));
    return { ok: true, token, device };
  }

  /** Best guess at this PC's tailnet name, from the Tailscale app if it's installed. */
  detectHost(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile("tailscale", ["status", "--json"], { timeout: 4000, windowsHide: true }, (err, out) => {
        if (err) return resolve(null);
        try {
          const name = (JSON.parse(String(out)) as { Self?: { DNSName?: string } }).Self?.DNSName?.replace(/\.$/, "");
          resolve(name || null);
        } catch {
          resolve(null);
        }
      });
    });
  }
}
