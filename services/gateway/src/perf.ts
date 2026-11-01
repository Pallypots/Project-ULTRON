import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Where does a reply's time go? One record per turn, with times in ms since the message reached the service, plus what
 * the browser measured (how long speech recognition took, when the first sound played) and the local model's own
 * timings. Kept in memory (last 200) and appended to logs/turns.jsonl; never contains what was said.
 */
export interface LlmStats {
  /** Loading the model into memory (non-zero means it had been unloaded). */
  loadMs: number;
  /** Reading the prompt ("prefill"): the main cost on a CPU when the prompt isn't cached. */
  promptTokens: number;
  promptMs: number;
  /** Writing the answer. */
  outputTokens: number;
  outputMs: number;
}

export interface TurnRecord {
  id: string;
  at: string;
  inputMode: "text" | "voice";
  provider: string;
  model: string;
  kind: "brain" | "instant" | "other";
  /** ms since the message arrived */
  marks: Partial<Record<"context_ready" | "llm_request" | "first_token" | "first_sentence" | "done", number>>;
  /** One entry per call to the local model in this turn (tool use makes several). */
  llm: LlmStats[];
  /** Measured in the browser. */
  client?: { sttMs?: number; endToSendMs?: number; firstAudioMs?: number };
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!);
};

export class TurnTrace {
  readonly t0 = performance.now();
  constructor(
    readonly rec: TurnRecord,
    private done: (r: TurnRecord) => void,
  ) {}
  mark(name: keyof TurnRecord["marks"]) {
    if (this.rec.marks[name] === undefined) this.rec.marks[name] = Math.round(performance.now() - this.t0);
  }
  llm(s: LlmStats) {
    this.rec.llm.push(s);
  }
  finish() {
    this.mark("done");
    this.done(this.rec);
  }
}

export class PerfLog {
  private turns: TurnRecord[] = [];
  private file: string;

  constructor(dataDir: string) {
    const dir = join(dataDir, "logs");
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "turns.jsonl");
    try {
      if (statSync(this.file).size > 5e6) renameSync(this.file, join(dir, "turns.old.jsonl"));
    } catch {}
  }

  start(meta: Omit<TurnRecord, "at" | "marks" | "llm" | "client">): TurnTrace {
    return new TurnTrace({ ...meta, at: new Date().toISOString(), marks: {}, llm: [] }, (r) => {
      this.turns.push(r);
      if (this.turns.length > 200) this.turns.shift();
      this.write(r);
    });
  }

  /** The browser reports its side (speech recognition time, time to first sound) once it knows. */
  client(id: string, c: NonNullable<TurnRecord["client"]>) {
    const r = this.turns.find((t) => t.id === id);
    if (!r) return false;
    r.client = { ...r.client, ...c };
    this.write({ ...r, at: r.at });
    return true;
  }

  private write(r: TurnRecord) {
    try {
      appendFileSync(this.file, JSON.stringify(r) + "\n");
    } catch {}
  }

  recent(n = 20) {
    return this.turns.slice(-n).reverse();
  }

  /** Typical (p50) and slow (p90) values for each stage over recent brain turns. */
  summary() {
    const brain = this.turns.filter((t) => t.kind === "brain").slice(-50);
    const col = (f: (t: TurnRecord) => number | undefined) => brain.map(f).filter((v): v is number => typeof v === "number");
    const stat = (f: (t: TurnRecord) => number | undefined) => {
      const xs = col(f);
      return { p50: pct(xs, 50), p90: pct(xs, 90), n: xs.length };
    };
    return {
      turns: brain.length,
      speechRecognition: stat((t) => t.client?.sttMs),
      context: stat((t) => t.marks.context_ready),
      modelLoad: stat((t) => t.llm[0]?.loadMs),
      promptReading: stat((t) => t.llm[0]?.promptMs),
      promptTokens: stat((t) => t.llm[0]?.promptTokens),
      firstWord: stat((t) => t.marks.first_token),
      firstSentence: stat((t) => t.marks.first_sentence),
      firstSound: stat((t) => t.client?.firstAudioMs),
      whole: stat((t) => t.marks.done),
      outputTokensPerSec: stat((t) => (t.llm[0] && t.llm[0].outputMs > 0 ? (t.llm[0].outputTokens / t.llm[0].outputMs) * 1000 : undefined)),
    };
  }
}
