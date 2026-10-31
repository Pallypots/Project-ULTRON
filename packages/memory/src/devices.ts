import type { Db } from "./db.ts";
import { now, uuid } from "./util.ts";

export interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

const toDevice = (r: any): Device => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at });

/** Paired devices (e.g. the owner's phone). Keys are stored only as hashes; revoking is immediate and permanent. */
export class DeviceStore {
  constructor(private db: Db) {}

  create(name: string, tokenHash: string): Device {
    const id = uuid();
    this.db.prepare("INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)").run(id, name, tokenHash, now());
    return this.get(id)!;
  }

  get(id: string): Device | null {
    const r = this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id);
    return r ? toDevice(r) : null;
  }

  /** The active (not revoked) device with this key hash, if any. */
  active(tokenHash: string): Device | null {
    const r = this.db.prepare("SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL").get(tokenHash);
    return r ? toDevice(r) : null;
  }

  list(): Device[] {
    return (this.db.prepare("SELECT * FROM devices ORDER BY revoked_at IS NOT NULL, created_at DESC").all() as any[]).map(toDevice);
  }

  touch(id: string) {
    this.db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now(), id);
  }

  revoke(id: string): boolean {
    return this.db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), id).changes > 0;
  }
}
