import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { Stores } from "@ultron/memory";

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

type Embed = (texts: string[]) => Promise<Float32Array[]>;

/** Deterministic stand-in for tests: hashed bag of word stems, so related phrasing overlaps a little. */
function mockEmbedder(): Embed {
  return async (texts) =>
    texts.map((t) => {
      const v = new Float32Array(256);
      for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
        const stem = w.slice(0, 5);
        let h = 0;
        for (const c of stem) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        v[h % 256]! += 1;
      }
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
}

/**
 * Local sentence embeddings (MiniLM, ~25 MB, downloads once) for meaning-based memory recall.
 * Everything runs on this PC. If the model isn't available, ULTRON falls back to keyword search.
 */
export class EmbeddingService {
  private embed: Embed | null = null;
  private loading: Promise<Embed | null> | null = null;
  state: "not_loaded" | "loading" | "ready" | "error" = "not_loaded";
  readonly model: string;

  constructor(
    private stores: Stores,
    private cacheDir: string,
    private mode = process.env.ULTRON_EMBEDDINGS ?? "local",
  ) {
    this.model = this.mode === "mock" ? "mock-embed" : EMBED_MODEL;
  }

  get enabled() {
    return this.mode !== "off";
  }

  private load(): Promise<Embed | null> {
    if (this.embed || !this.enabled) return Promise.resolve(this.embed);
    if (this.loading) return this.loading;
    this.state = "loading";
    this.loading = (async () => {
      if (this.mode === "mock") return mockEmbedder();
      mkdirSync(this.cacheDir, { recursive: true });
      const lib = await import("@huggingface/transformers");
      lib.env.cacheDir = this.cacheDir;
      const pipe = (await lib.pipeline("feature-extraction", EMBED_MODEL, { cache_dir: this.cacheDir, dtype: "fp32" })) as unknown as (t: string[], o: object) => Promise<{ data: Float32Array; dims: number[] }>;
      return async (texts: string[]) => {
        const out = await pipe(texts, { pooling: "mean", normalize: true });
        const dim = out.dims.at(-1)!;
        return texts.map((_, i) => out.data.slice(i * dim, (i + 1) * dim));
      };
    })()
      .then((e) => {
        this.embed = e;
        this.state = "ready";
        return e;
      })
      .catch(() => {
        this.state = "error"; // offline on first run, etc.: keyword recall keeps working
        this.loading = null;
        return null;
      });
    return this.loading;
  }

  /** Embeds memories that are new or changed. Safe to call often; runs in the background. */
  async backfill(): Promise<number> {
    const e = await this.load();
    if (!e) return 0;
    const todo = this.stores.memories.needingVectors(this.model, hash);
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16);
      const vecs = await e(batch.map((m) => m.content));
      batch.forEach((m, j) => this.stores.memories.setVector(m.id, this.model, hash(m.content), vecs[j]!));
    }
    return todo.length;
  }

  /** Meaning-based matches for a message; empty if the model isn't ready (keyword recall still applies). */
  async similar(text: string, limit = 6) {
    if (this.state !== "ready" || !this.embed) return [];
    const [q] = await this.embed([text]);
    return this.stores.memories.nearest(q!, this.model, limit, this.mode === "mock" ? 0.3 : 0.4);
  }
}
