import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, openDatabase, openStores, redact, rollback, migrate, toFtsQuery } from "../src/index.ts";

const tmpDb = () => join(mkdtempSync(join(tmpdir(), "ultron-mem-")), "test.db");

describe("migrations", () => {
  it("apply, roll back and re-apply cleanly", () => {
    const db = openDatabase(":memory:");
    const tables = () => (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'memories_fts_%'").all() as { name: string }[]).map((r) => r.name).sort();
    expect(tables()).toContain("memories");
    expect(rollback(db, 0)).toEqual(MIGRATIONS.map((m) => m.version).reverse());
    expect(tables()).toEqual(["schema_migrations"]);
    expect(migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(migrate(db)).toEqual([]);
  });
});

describe("conversations", () => {
  it("persist across reopen and recover interrupted replies", () => {
    const file = tmpDb();
    let s = openStores(file);
    const c = s.conversations.create();
    s.conversations.addMessage({ conversationId: c.id, role: "user", content: "hello" });
    s.conversations.addMessage({ conversationId: c.id, role: "assistant", content: "partial", status: "streaming" });
    s.close();

    s = openStores(file);
    expect(s.conversations.recoverInterrupted()).toBe(1);
    const msgs = s.conversations.messages(c.id);
    expect(msgs.map((m) => m.content)).toEqual(["hello", "partial [interrupted]"]);
    expect(msgs[1]!.status).toBe("cancelled");
    s.close();
  });
});

describe("memory store", () => {
  it("creates with provenance, retrieves by relevance, edits, and hard-deletes", () => {
    const s = openStores(":memory:");
    const a = s.memories.create({ content: "I prefer recipes that say whether preheating is needed", kind: "preference", source: "chat", sourceConversationId: "c1", sourceMessageId: "m1" });
    s.memories.create({ content: "My game port project is the Oogie's Revenge PC port", kind: "project", source: "manual" });

    expect(a.sourceConversationId).toBe("c1");
    expect(a.confirmed).toBe(true);
    expect(s.memories.search("how should recipes handle preheating?")[0]!.id).toBe(a.id);
    expect(s.memories.search("what about my game port")[0]!.content).toMatch(/Oogie/);
    expect(s.memories.search("completely unrelated astronomy")).toEqual([]);

    s.memories.update(a.id, { content: "I prefer recipes in metric units" });
    expect(s.memories.search("preheating")).toEqual([]);
    expect(s.memories.search("metric")[0]!.id).toBe(a.id);

    expect(s.memories.delete(a.id)).toBe(true);
    expect(s.memories.search("metric recipes")).toEqual([]);
    expect(s.memories.get(a.id)).toBeNull();
    const fts = s.db.prepare("SELECT count(*) n FROM memories_fts WHERE memory_id = ?").get(a.id) as { n: number };
    expect(fts.n).toBe(0);
  });

  it("always includes pinned memories in prompt retrieval", () => {
    const s = openStores(":memory:");
    const p = s.memories.create({ content: "Call me Boss", kind: "preference", source: "manual", pinned: true });
    expect(s.memories.retrieveForPrompt("what's the weather").map((m) => m.id)).toEqual([p.id]);
  });

  it("neutralises FTS syntax in queries", () => {
    expect(toFtsQuery('NEAR(") OR * "drop')).toBe('"near" OR "drop"');
    expect(toFtsQuery("the and of")).toBeNull();
  });
});

describe("redaction", () => {
  it("removes secrets by key name and by value pattern", () => {
    const out = redact({ apiKey: "abc", note: "key is sk-ant-abcdefghijklmnop", nested: { Authorization: "Bearer xyz" } });
    expect(JSON.stringify(out)).not.toMatch(/abc"|sk-ant-abcdef|xyz/);
  });

  it("audit log never stores secrets", () => {
    const s = openStores(":memory:");
    s.audit.record("test", "owner", null, { token: "supersecret", msg: "ghp_abcdefghijklmnopqrstuvwxyz123" });
    expect(JSON.stringify(s.audit.list())).not.toMatch(/supersecret|ghp_abc/);
  });
});
