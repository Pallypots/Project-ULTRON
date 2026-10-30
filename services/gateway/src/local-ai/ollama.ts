import { DEFAULT_OLLAMA_URL } from "@ultron/agent-core";

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  parameterSize: string | null;
  family: string | null;
}

export interface PullState {
  model: string;
  status: "downloading" | "success" | "error" | "cancelled";
  detail: string;
  completedBytes: number;
  totalBytes: number;
  startedAt: string;
}

/** Talks to the owner's local Ollama server: health, installed models, and resumable downloads. */
export class OllamaManager {
  private pulls = new Map<string, { state: PullState; ctl: AbortController }>();

  constructor(
    private baseUrl = DEFAULT_OLLAMA_URL,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  get url() {
    return this.baseUrl;
  }

  setUrl(url: string) {
    this.baseUrl = (url || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  }

  async version(): Promise<string | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return null;
      return ((await res.json()) as { version?: string }).version ?? "unknown";
    } catch {
      return null;
    }
  }

  async models(): Promise<InstalledModel[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = (await res.json()) as { models?: { name: string; size: number; details?: { parameter_size?: string; family?: string } }[] };
    return (data.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      parameterSize: m.details?.parameter_size ?? null,
      family: m.details?.family ?? null,
    }));
  }

  pullStates(): PullState[] {
    return [...this.pulls.values()].map((p) => p.state);
  }

  /** Starts (or joins) a background download. Progress is read with pullStates(). */
  startPull(model: string): PullState {
    const existing = this.pulls.get(model);
    if (existing?.state.status === "downloading") return existing.state;
    const ctl = new AbortController();
    const state: PullState = { model, status: "downloading", detail: "Starting download…", completedBytes: 0, totalBytes: 0, startedAt: new Date().toISOString() };
    this.pulls.set(model, { state, ctl });
    this.runPull(state, ctl.signal).catch((err: Error) => {
      if (ctl.signal.aborted) Object.assign(state, { status: "cancelled", detail: "Download cancelled. Starting again resumes where it stopped." });
      else Object.assign(state, { status: "error", detail: friendlyPullError(err.message) });
    });
    return state;
  }

  cancelPull(model: string): boolean {
    const p = this.pulls.get(model);
    if (!p || p.state.status !== "downloading") return false;
    p.ctl.abort();
    return true;
  }

  private async runPull(state: PullState, signal: AbortSignal) {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/pull`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: state.model, stream: true }), signal });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new Error("Ollama isn't running.");
    }
    if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || `Ollama returned ${res.status}`);
    const layers = new Map<string, { total: number; completed: number }>();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let sawSuccess = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as { status?: string; digest?: string; total?: number; completed?: number; error?: string };
        if (ev.error) throw new Error(ev.error);
        if (ev.digest && ev.total) {
          layers.set(ev.digest, { total: ev.total, completed: ev.completed ?? layers.get(ev.digest)?.completed ?? 0 });
          state.totalBytes = [...layers.values()].reduce((a, l) => a + l.total, 0);
          state.completedBytes = [...layers.values()].reduce((a, l) => a + l.completed, 0);
          state.detail = "Downloading…";
        } else if (ev.status === "success") {
          sawSuccess = true;
        } else if (ev.status) {
          state.detail = ev.status.startsWith("pulling ") ? "Downloading…" : ev.status.charAt(0).toUpperCase() + ev.status.slice(1) + "…";
        }
      }
    }
    // Only report success once Ollama has finished the stream (the model is registered by then).
    if (!sawSuccess) throw new Error("The download ended unexpectedly.");
    Object.assign(state, { status: "success", detail: "Downloaded and ready.", completedBytes: state.totalBytes });
  }
}

function friendlyPullError(msg: string): string {
  if (/file does not exist|not found|manifest unknown/i.test(msg)) return "That model name wasn't found in the Ollama library. Check the spelling at ollama.com/library.";
  if (/isn't running/i.test(msg)) return "Ollama isn't running. Start the Ollama app and try again.";
  if (/space|disk/i.test(msg)) return "Not enough disk space for this model.";
  if (/dial|network|timeout|connection/i.test(msg)) return "Couldn't reach the Ollama library. Check your internet connection (only needed for the download).";
  return `Download failed: ${msg}`;
}
