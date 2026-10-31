import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStores } from "@ultron/memory";
import { EmbeddingService } from "../src/embeddings/index.ts";

const seed = (s: ReturnType<typeof openStores>) => {
  s.memories.create({ content: "I prefer instructions that say whether preheating is needed", kind: "preference", source: "chat" });
  s.memories.create({ content: "My sister's birthday is March 3", kind: "fact", source: "chat" });
  s.memories.create({ content: "My main project is the Oogie's Revenge PC port", kind: "project", source: "chat" });
};

describe("meaning-based recall (deterministic test embedder)", () => {
  it("stores vectors, keeps them fresh after edits, drops them on delete, and merges with keyword search", async () => {
    const s = openStores(":memory:");
    seed(s);
    const e = new EmbeddingService(s, tmpdir(), "mock");
    expect(await e.backfill()).toBe(3);
    expect(await e.backfill()).toBe(0); // nothing stale
    const target = s.memories.list().find((m) => m.content.includes("sister"))!;
    s.memories.update(target.id, { content: "My sister's birthday is March 4" });
    expect(await e.backfill()).toBe(1);
    const sim = await e.similar("birthday plans for my sisters");
    expect(sim[0]!.memory.id).toBe(target.id);
    expect(s.memories.retrieveHybrid("birthday plans for my sisters", sim)[0]!.id).toBe(target.id);
    s.memories.delete(target.id);
    expect((s.db.prepare("SELECT count(*) n FROM memory_vectors").get() as { n: number }).n).toBe(2);
  });

  it("does nothing (keyword recall only) when turned off", async () => {
    const s = openStores(":memory:");
    seed(s);
    const e = new EmbeddingService(s, tmpdir(), "off");
    expect(await e.backfill()).toBe(0);
    expect(await e.similar("anything")).toEqual([]);
  });
});

// Real local model (MiniLM ~25 MB download). CI only.
describe.skipIf(process.env.ULTRON_TEST_EMBED !== "1")("meaning-based recall (real local model)", () => {
  it("finds memories that share no keywords with the question", async () => {
    const s = openStores(":memory:");
    seed(s);
    const e = new EmbeddingService(s, process.env.ULTRON_TEST_MODEL_DIR ?? join(tmpdir(), "ultron-test-models"), "local");
    const t = Date.now();
    expect(await e.backfill()).toBe(3);
    const q = "how should recipes mention warming the oven?";
    expect(s.memories.search(q)).toEqual([]); // keyword search alone finds nothing
    const sim = await e.similar(q);
    const top = sim[0]?.memory.content ?? "";
    const q2 = "when is my sibling's special day?";
    const top2 = (await e.similar(q2))[0]?.memory.content ?? "";
    const summary = `"${q}" -> "${top}" (score ${sim[0]?.score.toFixed(2)}); "${q2}" -> "${top2}"; load+embed ${Date.now() - t}ms`;
    console.log(`[embeddings] ${summary}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Meaning-based memory recall (${process.platform})::${summary}`);
    expect(top).toMatch(/preheating/);
    expect(top2).toMatch(/birthday/);
  }, 600_000);
});

const seedFiles = (s: ReturnType<typeof openStores>) => {
  const folder = s.files.addFolder(join(tmpdir(), "projects"));
  const add = (name: string, text: string) =>
    s.files.upsertDoc({ folderId: folder.id, path: join(tmpdir(), "projects", name), name, ext: "md", size: text.length, mtimeMs: Date.now(), chunks: [text] });
  add("oogie-build-notes.md", "Level 3 still has an audio crackle whenever the boss arena loads; the sound mixer buffer is too small.");
  add("pizza.md", "Neapolitan dough: 48 hours cold fermentation, then bake as hot as the oven goes.");
  add("taxes-2026.md", "Receipts for home office equipment and the accountant's phone number.");
  return folder;
};

describe("meaning-based file search (deterministic test embedder)", () => {
  it("embeds leading chunks once, re-embeds changed files, and forgets removed folders", async () => {
    const s = openStores(":memory:");
    const folder = seedFiles(s);
    const e = new EmbeddingService(s, tmpdir(), "mock");
    expect(await e.backfillDocs()).toBe(3);
    expect(await e.backfillDocs()).toBe(0);
    const hits = await e.similarFiles("sound mixer buffer crackle");
    expect(hits[0]!.name).toBe("oogie-build-notes.md");
    s.files.removeFolder(folder.id);
    expect((s.db.prepare("SELECT count(*) n FROM doc_vectors").get() as { n: number }).n).toBe(0);
  });
});

describe.skipIf(process.env.ULTRON_TEST_EMBED !== "1")("meaning-based file search (real local model)", () => {
  it("finds a file that shares no keywords with the question", async () => {
    const s = openStores(":memory:");
    seedFiles(s);
    const e = new EmbeddingService(s, process.env.ULTRON_TEST_MODEL_DIR ?? join(tmpdir(), "ultron-test-models"), "local");
    await e.backfillDocs();
    const q = "where did I write down that popping noise glitch?";
    expect(s.files.search(q).map((h) => h.name)).not.toContain("oogie-build-notes.md");
    const top = (await e.similarFiles(q))[0];
    const { ciNote } = await import("./helpers.ts");
    ciNote("Meaning-based file search", `"${q}" -> ${top?.name} (score ${top?.score.toFixed(2)}); keyword search alone: ${JSON.stringify(s.files.search(q).map((h) => h.name))}`);
    expect(top?.name).toBe("oogie-build-notes.md");
  }, 600_000);
});
