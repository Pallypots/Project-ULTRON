import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { FileIndexStore } from "@ultron/memory";
import { docxText } from "./docx.ts";

const TEXT_EXT = new Set(
  "txt md markdown csv tsv json jsonl yaml yml toml ini cfg conf log xml html htm css js mjs cjs ts tsx jsx py rb go rs java kt c h cpp hpp cs php sh ps1 bat sql srt vtt tex rst org lua gd gdscript cmake gradle".split(" "),
);
const SKIP_DIRS = new Set(["node_modules", ".git", "$recycle.bin", "system volume information", "__pycache__", ".venv", "venv", "appdata", ".cache", "target", ".next", ".gradle"]);
// Never read secrets, even inside an approved folder.
const SENSITIVE = /(^\.env|\.pem$|\.key$|\.pfx$|\.p12$|\.ppk$|\.kdbx?$|^id_(rsa|ed25519|ecdsa|dsa)|password|passwd|secret|credential|wallet\.dat$|\.keystore$|\.jks$)/i;

export const LIMITS = { maxFiles: 25_000, maxDepth: 14, maxReadBytes: 2_000_000, maxIndexChars: 200_000, chunkChars: 1500 };

export class FolderError extends Error {}

/** Checks a folder is safe and sensible to index; returns its real path. */
export async function validateFolder(input: string, dataDir: string): Promise<string> {
  const raw = input.trim().replace(/^"|"$/g, "");
  if (!raw || !isAbsolute(raw)) throw new FolderError('Enter a full folder path, e.g. "C:\\Users\\you\\Documents\\Projects".');
  let real: string;
  try {
    real = await realpath(resolve(raw));
  } catch {
    throw new FolderError("That folder doesn't exist on this computer.");
  }
  if (!(await stat(real)).isDirectory()) throw new FolderError("That's a file, not a folder.");
  const lower = real.toLowerCase();
  const root = parse(real).root;
  if (real === root || real === root.replace(/[\\/]$/, "")) throw new FolderError("Indexing a whole drive isn't allowed. Pick a specific folder.");
  const home = homedir();
  if (real === home) throw new FolderError("Your entire user folder is too broad. Pick specific folders like Documents\\Projects.");
  const dataReal = await realpath(dataDir).catch(() => dataDir);
  if (real === dataReal || real.startsWith(dataReal + sep) || dataReal.startsWith(real + sep)) throw new FolderError("ULTRON's own data folder can't be indexed.");
  // AppData holds browser profiles, saved passwords and app secrets, so it's never indexable.
  const blocked = [/^[a-z]:\\windows(\\|$)/, /^[a-z]:\\program files/, /^[a-z]:\\programdata/, /\\appdata(\\|$)/, /^\/(etc|usr|bin|sbin|proc|sys|dev|var|boot|root)(\/|$)/, /[\\/]\.ssh([\\/]|$)/, /[\\/]\.gnupg([\\/]|$)/];
  if (blocked.some((re) => re.test(lower))) throw new FolderError("System and credential folders can't be indexed.");
  return real;
}

/** True if `target` (resolved for symlinks) is inside one of the approved folders. */
export async function insideApproved(target: string, approved: string[]): Promise<string | null> {
  // Reject network (UNC) and device paths before touching the filesystem: resolving them can contact other machines.
  if (/^(\\\\|\/\/)/.test(target) || /^\\\\[?.]\\/.test(target) || !isAbsolute(target)) return null;
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    return null;
  }
  for (const a of approved) {
    const rel = relative(a, real);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return real;
  }
  return null;
}

export function chunkText(text: string, size = LIMITS.chunkChars): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const out: string[] = [];
  for (let i = 0; i < clean.length && out.length < 140; i += size) out.push(clean.slice(i, i + size));
  return out;
}

export async function extractText(path: string, ext: string, size: number): Promise<string | null> {
  if (size > LIMITS.maxReadBytes) return null;
  if (ext === "docx") {
    try {
      return docxText(await readFile(path))?.slice(0, LIMITS.maxIndexChars) ?? null;
    } catch {
      return null;
    }
  }
  if (!TEXT_EXT.has(ext)) return null;
  const buf = await readFile(path);
  if (buf.subarray(0, 8000).includes(0)) return null; // binary
  return buf.toString("utf8").slice(0, LIMITS.maxIndexChars);
}

/**
 * Walks one approved folder and updates the index incrementally (unchanged files are skipped).
 * Yields to the event loop regularly so ULTRON stays responsive while indexing.
 */
export async function indexFolder(store: FileIndexStore, folderId: string, root: string, onProgress?: (n: number) => void): Promise<{ files: number; contentIndexed: number; truncated: boolean }> {
  const existing = store.docsByPath(folderId);
  const seen = new Set<string>();
  let files = 0;
  let contentIndexed = 0;
  let truncated = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > LIMITS.maxDepth || truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder: skip
    }
    for (const e of entries) {
      if (truncated) return;
      const name = e.name;
      if (name.startsWith(".") || name.startsWith("~$") || SENSITIVE.test(name)) continue;
      const full = join(dir, name);
      if (e.isSymbolicLink()) continue; // never follow links out of the approved folder
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(name.toLowerCase())) await walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      if (++files > LIMITS.maxFiles) {
        truncated = true;
        return;
      }
      seen.add(full);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      const prev = existing.get(full);
      if (prev && prev.mtimeMs === Math.floor(st.mtimeMs) && prev.size === st.size) continue;
      const ext = extname(name).slice(1).toLowerCase();
      let text: string | null = null;
      try {
        text = await extractText(full, ext, st.size);
      } catch {
        text = null;
      }
      if (text) contentIndexed++;
      store.upsertDoc({ folderId, path: full, name: basename(name), ext, size: st.size, mtimeMs: Math.floor(st.mtimeMs), chunks: text ? chunkText(text) : null }, prev?.id);
      if (files % 100 === 0) {
        onProgress?.(files);
        await new Promise((r) => setImmediate(r));
      }
    }
  };
  await walk(root, 0);
  store.removeDocs([...existing.entries()].filter(([p]) => !seen.has(p)).map(([, d]) => d.id));
  return { files: Math.min(files, LIMITS.maxFiles), contentIndexed, truncated };
}
