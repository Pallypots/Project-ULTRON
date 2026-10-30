import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { REPO_ROOT } from "../src/config.ts";
import { basename, join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { openStores } from "@ultron/memory";
import { docxText } from "../src/files/docx.ts";
import { chunkText, indexFolder, validateFolder } from "../src/files/indexer.ts";
import { replyText, startGateway } from "./helpers.ts";

process.env.ULTRON_ACTIONS_DRY_RUN = "1";

// On Windows the temp folder is inside AppData, which ULTRON (rightly) refuses to index, so use a folder in the repo.
const testBase = () => {
  const base = process.platform === "win32" ? join(REPO_ROOT, ".test-tmp") : tmpdir();
  mkdirSync(base, { recursive: true });
  return base;
};

/** Builds a minimal .docx (zip with word/document.xml) for tests. */
function makeDocx(paragraphs: string[]): Buffer {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;
  const name = Buffer.from("word/document.xml");
  const data = deflateRawSync(Buffer.from(xml));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = 30 + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function makeProjectTree() {
  const root = mkdtempSync(join(testBase(), "ultron-files-"));
  mkdirSync(join(root, "Free School Community"), { recursive: true });
  mkdirSync(join(root, "node_modules/junk"), { recursive: true });
  mkdirSync(join(root, ".hidden"));
  writeFileSync(join(root, "Free School Community/plan.md"), "# Community launch\nWeekly workshops on AI tools, onboarding checklist.");
  writeFileSync(join(root, "Free School Community/members.csv"), "name,joined\nAlex,2026-01-02");
  writeFileSync(join(root, "oogie-port-build.log"), "Build 42 failed: missing shader cache in renderer");
  writeFileSync(join(root, "invoice-mike-johnson.docx"), makeDocx(["Invoice for Mike Johnson", "AI reputation build: $2,500"]));
  writeFileSync(join(root, ".env"), "API_KEY=sk-live-should-never-be-indexed");
  writeFileSync(join(root, "passwords.txt"), "bank: hunter2");
  writeFileSync(join(root, "node_modules/junk/index.js"), "workshops workshops workshops");
  writeFileSync(join(root, ".hidden/notes.txt"), "workshops");
  writeFileSync(join(root, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
  return root;
}

let cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});

describe("indexer", () => {
  it("extracts .docx text and chunks long text", () => {
    expect(docxText(makeDocx(["Hello", "World & co"]))).toBe("Hello\nWorld & co\n");
    expect(chunkText("a".repeat(4000), 1500)).toHaveLength(3);
  });

  it("indexes names and contents, skipping secrets, hidden, dependency and binary content", async () => {
    const root = makeProjectTree();
    const s = openStores(":memory:");
    const f = s.files.addFolder(root);
    const r = await indexFolder(s.files, f.id, root);
    expect(r.files).toBe(5); // plan.md, members.csv, build log, docx, png
    expect(s.files.search("workshops").map((h) => h.name)).toEqual(["plan.md"]);
    expect(s.files.search("free school community")[0]!.path).toMatch(/Free School Community/);
    expect(s.files.search("reputation build")[0]!.name).toBe("invoice-mike-johnson.docx");
    expect(s.files.search("shader cache")[0]!.snippet).toMatch(/«shader» «cache»/);
    expect(s.files.search("hunter2")).toEqual([]);
    expect(s.files.search("should never be indexed")).toEqual([]);
    expect(s.files.search("photo")[0]!.name).toBe("photo.png");
  });

  it("re-indexes incrementally and drops deleted files", async () => {
    const root = makeProjectTree();
    const s = openStores(":memory:");
    const f = s.files.addFolder(root);
    await indexFolder(s.files, f.id, root);
    writeFileSync(join(root, "oogie-port-build.log"), "Build 43 passed after fixing the shader cache");
    utimesSync(join(root, "oogie-port-build.log"), new Date(), new Date(Date.now() + 5000));
    await indexFolder(s.files, f.id, root);
    expect(s.files.search("passed")[0]!.name).toBe("oogie-port-build.log");
    expect(s.files.search("missing")).toEqual([]);
    expect(s.files.removeFolder(f.id)).toBe(true);
    expect(s.files.search("shader")).toEqual([]);
  });

  it("refuses drives, home, system, credential and ULTRON's own folders", async () => {
    const data = mkdtempSync(join(tmpdir(), "ultron-data-"));
    await expect(validateFolder("relative/path", data)).rejects.toThrow(/full folder path/);
    await expect(validateFolder("/", data)).rejects.toThrow(/whole drive/);
    await expect(validateFolder(homedir(), data)).rejects.toThrow(/too broad/);
    await expect(validateFolder(process.platform === "win32" ? "C:\\Windows" : "/etc", data)).rejects.toThrow(/System/);
    await expect(validateFolder(data, data)).rejects.toThrow(/own data folder/);
    await expect(validateFolder("/definitely/not/here", data)).rejects.toThrow(/doesn't exist/);
    const ok = makeProjectTree();
    await expect(validateFolder(ok, data)).resolves.toBeTruthy();
  });
});

describe("files through the gateway", () => {
  async function setup() {
    const g = await startGateway();
    cleanup.push(g.close);
    const root = makeProjectTree();
    const add = await g.api("POST", "/api/files/folders", { path: root });
    expect(add.status).toBe(200);
    for (let i = 0; i < 100; i++) {
      const f = (await g.api("GET", "/api/files/folders")).body.folders[0];
      if (f.status === "ready") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    return { ...g, root };
  }

  it("owner search and open, with clear errors for bad folders", async () => {
    const g = await setup();
    const res = (await g.api("POST", "/api/files/search", { query: "community workshops" })).body.results;
    expect(res[0].name).toBe("plan.md");
    expect((await g.api("POST", "/api/files/open", { docId: res[0].docId })).body).toMatchObject({ ok: true });
    expect((await g.api("POST", "/api/files/folders", { path: g.root })).body.message).toMatch(/already added/);
    expect((await g.api("POST", "/api/files/folders", { path: "/etc" })).status).toBe(400);
  });

  it("the brain can search files (read-only, no approval) and results are cited", async () => {
    const g = await setup();
    const events = await g.chat(await g.newConversation(), "pull up the free school community");
    const tool = events.find((e) => e.type === "tool") as any;
    expect(tool.event).toMatchObject({ tool: "search_files", status: "succeeded", risk: 0 });
    expect(replyText(events)).toMatch(/Free School Community/);
  });

  it("reading is limited to approved folders; opening needs approval; traversal and symlinks are blocked", async () => {
    const g = await setup();
    const id = await g.newConversation();
    const outside = mkdtempSync(join(testBase(), "outside-"));
    writeFileSync(join(outside, "secret.txt"), "top secret");
    try {
      symlinkSync(outside, join(g.root, "Free School Community", "escape"), "junction");
    } catch {
      /* creating links needs extra rights on some Windows setups; the traversal check below still runs */
    }
    const traversal = join(g.root, "..", basename(outside), "secret.txt");
    const r1 = replyText(await g.chat(id, `mock-tool open_on_screen ${JSON.stringify({ path: traversal })}`));
    expect(r1).toMatch(/needs your approval/);
    const pending = (await g.api("GET", "/api/actions")).body.pending[0];
    const approved = (await g.api("POST", `/api/actions/${pending.id}/approve`)).body.action;
    expect(approved).toMatchObject({ status: "failed", error: expect.stringMatching(/Only files and folders inside your approved folders/) });
    expect(replyText(await g.chat(id, 'mock-tool read_file {"file_id":"not-a-real-id"}'))).toMatch(/isn't in an approved folder/);
    // The symlink is never followed by the indexer.
    expect((await g.api("POST", "/api/files/search", { query: "top secret" })).body.results).toEqual([]);
    const ok = (await g.api("POST", "/api/files/search", { query: "shader" })).body.results[0];
    expect(replyText(await g.chat(id, `mock-tool read_file {"file_id":"${ok.docId}"}`))).toMatch(/untrusted_file_content.*shader cache/);
  });

  it("removing a folder removes its index", async () => {
    const g = await setup();
    const f = (await g.api("GET", "/api/files/folders")).body.folders[0];
    expect((await g.api("DELETE", `/api/files/folders/${f.id}`)).status).toBe(200);
    expect((await g.api("POST", "/api/files/search", { query: "shader" })).body.results).toEqual([]);
  });
});
