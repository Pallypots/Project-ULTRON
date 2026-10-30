import { execFile } from "node:child_process";
import type { FileIndexStore, Folder } from "@ultron/memory";
import { indexFolder, insideApproved, validateFolder } from "./indexer.ts";

const REINDEX_EVERY_MS = 30 * 60_000;

/** Owner-approved folders: adding, background (re)indexing, and safe path checks for tools. */
export class FileService {
  private running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private store: FileIndexStore,
    private dataDir: string,
    private log: (msg: string) => void = () => {},
  ) {}

  start() {
    // Re-index once at startup (catches changes made while ULTRON was off), then periodically.
    for (const f of this.store.folders()) this.reindex(f.id);
    this.timer = setInterval(() => this.store.folders().forEach((f) => this.reindex(f.id)), REINDEX_EVERY_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async add(path: string): Promise<Folder> {
    const real = await validateFolder(path, this.dataDir);
    if (this.store.folders().some((f) => f.path === real)) throw new Error("That folder is already added.");
    const folder = this.store.addFolder(real);
    this.reindex(folder.id);
    return folder;
  }

  /** Starts indexing in the background; progress is visible in folder status. */
  reindex(id: string): boolean {
    const f = this.store.folder(id);
    if (!f || this.running.has(id)) return false;
    this.running.add(id);
    this.store.setFolderStatus(id, "indexing", "Scanning…");
    indexFolder(this.store, id, f.path, (n) => this.store.setFolderStatus(id, "indexing", `Scanned ${n} files…`))
      .then(({ files, contentIndexed, truncated }) => {
        if (!this.store.folder(id)) return; // removed while indexing
        this.store.setFolderStatus(id, "ready", `${files} files, ${contentIndexed} readable${truncated ? " (stopped at the 25,000-file limit)" : ""}`, files);
      })
      .catch((err: Error) => {
        this.log(`indexing failed: ${err.message}`);
        if (this.store.folder(id)) this.store.setFolderStatus(id, "error", `Indexing failed: ${err.message}`);
      })
      .finally(() => this.running.delete(id));
    return true;
  }

  get indexing() {
    return this.running.size > 0;
  }

  approvedRoots(): string[] {
    return this.store.folders().map((f) => f.path);
  }

  /** Resolves a path for reading/opening only if it's inside an approved folder (symlinks resolved). */
  async safePath(path: string): Promise<string | null> {
    return insideApproved(path, this.approvedRoots());
  }
}

/** Opens a file or folder with its default app, without a shell. */
export function openWithDefaultApp(path: string): Promise<void> {
  const [cmd, args] = process.platform === "win32" ? ["explorer.exe", [path]] : process.platform === "darwin" ? ["open", [path]] : ["xdg-open", [path]];
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { windowsHide: true, timeout: 10_000 }, (err) => {
      if (err && !(process.platform === "win32" && (err as { code?: number }).code === 1)) reject(new Error("Couldn't open it on this computer."));
      else resolve();
    });
    child.unref();
  });
}
