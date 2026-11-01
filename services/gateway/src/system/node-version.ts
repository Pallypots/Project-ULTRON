/**
 * Node.js versions with the October 2026 security fixes (incl. CVE-2026-111497, a Brotli decoder flaw that allows
 * remote code execution; ULTRON downloads web pages, so this matters). Lines not listed are unsupported/end-of-life.
 * Source: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
 */
export const PATCHED: Record<number, [number, number]> = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };

export function nodeSecurity(version = process.versions.node): { ok: boolean; message: string | null } {
  const [major, minor, patch] = version.split(".").map(Number) as [number, number, number];
  const min = PATCHED[major];
  if (!min) return { ok: false, message: `Node.js ${version} isn't a supported, patched release line. Install Node.js 22 LTS (22.23.4 or newer) from nodejs.org.` };
  const ok = minor > min[0] || (minor === min[0] && patch >= min[1]);
  return ok ? { ok: true, message: null } : { ok: false, message: `Node.js ${version} has known security flaws (fixed in ${major}.${min[0]}.${min[1]}). Update Node.js from nodejs.org (LTS), then restart ULTRON.` };
}
