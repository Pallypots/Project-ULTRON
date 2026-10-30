// `npm run backup`: consistent snapshot of the ULTRON database (safe while ULTRON is running).
// Secrets (API keys) are deliberately NOT included in backups.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const dataDir = process.env.ULTRON_DATA_DIR ?? (platform() === "win32" && process.env.APPDATA ? join(process.env.APPDATA, "ULTRON") : join(homedir(), ".ultron"));
const dbFile = join(dataDir, "ultron.db");
if (!existsSync(dbFile)) {
  console.error(`No ULTRON database found at ${dbFile}. Start ULTRON once first.`);
  process.exit(1);
}
const outDir = join(dataDir, "backups");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `ultron-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
const db = new DatabaseSync(dbFile);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
const check = new DatabaseSync(out, { readOnly: true });
const ok = check.prepare("PRAGMA integrity_check").get();
const counts = check.prepare("SELECT (SELECT count(*) FROM conversations) c, (SELECT count(*) FROM memories) m").get();
check.close();
console.log(`Backup saved: ${out}\nIntegrity: ${Object.values(ok)[0]} · ${counts.c} conversations · ${counts.m} memories`);
console.log("To restore: stop ULTRON, then copy this file over ultron.db in the data folder.");
