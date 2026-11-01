import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOST = fileURLToPath(new URL("./host.ts", import.meta.url));

/**
 * The parent side of a model host process. Starts it on first use, restarts it after a crash, and fails pending
 * requests with a clear error instead of hanging. Each request has a time limit.
 */
export class ModelProcess {
  private child: ChildProcess | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  onProgress?: (pct: number) => void;
  /** Called when the process stops unexpectedly (so the engine can forget that its model was loaded). */
  onCrash?: (why: string) => void;
  crashes = 0;

  constructor(private readonly name: string) {}

  private start(): ChildProcess {
    if (this.child) return this.child;
    const child = fork(HOST, [], {
      execArgv: ["--import", "tsx", "--disable-warning=ExperimentalWarning"],
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: { ...process.env },
    });
    child.on("message", (m: { id?: number; result?: unknown; error?: string; kind?: string; pct?: number }) => {
      if (m.kind === "progress") return this.onProgress?.(m.pct ?? 0);
      const p = m.id !== undefined ? this.pending.get(m.id) : undefined;
      if (!p) return;
      this.pending.delete(m.id!);
      clearTimeout(p.timer);
      if (m.error !== undefined) p.reject(new Error(m.error));
      else p.resolve(m.result);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      const why = `the ${this.name} process stopped (${signal ?? `code ${code}`})`;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(why));
      }
      this.pending.clear();
      if (!this.stopping) {
        this.crashes++;
        this.onCrash?.(why);
      }
    });
    child.on("error", () => {});
    this.child = child;
    return child;
  }

  private stopping = false;

  request<T>(msg: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const child = this.start();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} took too long`));
        // A stuck model is restarted rather than left blocking everything behind it.
        this.kill();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ ...msg, id });
    });
  }

  kill() {
    const c = this.child;
    if (!c) return;
    this.child = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`${this.name} was restarted`));
    }
    this.pending.clear();
    this.onCrash?.(`${this.name} was restarted`);
    c.kill();
  }

  stop() {
    this.stopping = true;
    this.child?.kill();
    this.child = null;
  }

  get pid() {
    return this.child?.pid ?? null;
  }
}
