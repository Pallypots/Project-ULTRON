// A fingerprint of ULTRON's code, so the launcher can tell whether the running service (or the built interface) is the
// code in this folder. Based on file names, sizes and modification times (fast; no need to read every file).
//   node scripts/code-stamp.mjs ui       → interface sources
//   node scripts/code-stamp.mjs service  → service sources
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const SETS = {
  ui: ["apps/desktop/src", "apps/desktop/index.html", "apps/desktop/public", "apps/desktop/vite.config.ts", "package.json", "package-lock.json"],
  service: ["services/gateway/src", "packages", "config", "package.json", "package-lock.json"],
};

export function codeStamp(which) {
  const h = createHash("sha256");
  const walk = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p).sort()) if (name !== "node_modules" && name !== "dist" && name !== "test" && !name.startsWith(".")) walk(join(p, name));
    } else h.update(`${relative(root, p).replace(/\\/g, "/")}:${st.size}:${Math.round(st.mtimeMs)}\n`);
  };
  for (const p of SETS[which]) walk(join(root, p));
  return h.digest("hex").slice(0, 16);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  process.stdout.write(codeStamp(process.argv[2] === "service" ? "service" : "ui"));
}
