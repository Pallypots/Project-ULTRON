// Regression tests for the overnight security review findings.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { docxText } from "../src/files/docx.ts";
import { insideApproved } from "../src/files/indexer.ts";
import { openTarget } from "../src/files/service.ts";
import { REPO_ROOT } from "../src/config.ts";
import { replyText, startGateway } from "./helpers.ts";

process.env.ULTRON_ACTIONS_DRY_RUN = "1";
const base = () => {
  const b = process.platform === "win32" ? join(REPO_ROOT, ".test-tmp") : tmpdir();
  mkdirSync(b, { recursive: true });
  return b;
};
let cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});

function zipWith(name: string, data: Buffer, rawSize: number): Buffer {
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(rawSize, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(rawSize, 24);
  central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(30 + n.length + data.length, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}

describe("review fix #2: zip bombs", () => {
  it("refuses to inflate a .docx past 5 MB, even when the size field lies", () => {
    const bomb = deflateRawSync(Buffer.alloc(200_000_000, 0x41)); // ~200 MB of 'A' compresses to ~200 KB
    const t = Date.now();
    expect(docxText(zipWith("word/document.xml", bomb, 1000))).toBeNull(); // lying size field
    expect(docxText(zipWith("word/document.xml", bomb, 200_000_000))).toBeNull(); // honest size field
    expect(Date.now() - t).toBeLessThan(3000);
    expect(docxText(Buffer.from("PK garbage"))).toBeNull();
  });
});

describe("review fix #3: opening files safely", () => {
  it("never launches programs or shortcuts, opens their folder instead", () => {
    expect(openTarget(join("C:", "proj", "tools", "view-docs.bat"))).toMatchObject({ path: join("C:", "proj", "tools"), note: expect.stringMatching(/opens its folder/) });
    expect(openTarget(join("C:", "proj", "notes.TXT")).note).toBeNull();
  });

  it("rejects network and device paths before touching the filesystem", async () => {
    expect(await insideApproved("\\\\attacker\\share\\x.txt", [base()])).toBeNull();
    expect(await insideApproved("//attacker/share/x.txt", [base()])).toBeNull();
    expect(await insideApproved("\\\\?\\C:\\x", [base()])).toBeNull();
    expect(await insideApproved("relative/x.txt", [base()])).toBeNull();
  });

  it("refuses to open a link whose target differs from what the approval card named", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const root = mkdtempSync(join(base(), "ultron-open-"));
    writeFileSync(join(root, "payload.txt"), "x");
    try {
      symlinkSync(join(root, "payload.txt"), join(root, "notes.txt"));
    } catch {
      return; // creating links needs extra rights on some Windows setups
    }
    await g.api("POST", "/api/files/folders", { path: root });
    await g.chat(await g.newConversation(), `mock-tool open_on_screen ${JSON.stringify({ path: join(root, "notes.txt") })}`);
    const pending = (await g.api("GET", "/api/actions")).body.pending[0];
    const res = (await g.api("POST", `/api/actions/${pending.id}/approve`)).body.action;
    expect(res).toMatchObject({ status: "failed", error: expect.stringMatching(/link to a different file/) });
  });
});

describe("review fix #5: forgetting and voice safety", () => {
  it("deletes nothing on a weak or ambiguous match", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const id = await g.newConversation();
    await g.chat(id, "Remember that the weekly team meeting is Monday at 9am");
    expect(replyText(await g.chat(id, "forget about the meeting with Dana"))).toMatch(/didn't delete anything/);
    expect((await g.api("GET", "/api/memories")).body.memories).toHaveLength(1);
    expect(replyText(await g.chat(id, "forget the weekly team meeting"))).toMatch(/Forgotten/);
    expect((await g.api("GET", "/api/memories")).body.memories).toHaveLength(0);
  });

  it("voice can't delete memories or switch to a cloud brain", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const id = await g.newConversation();
    await g.chat(id, "Remember that my favourite editor is Neovim");
    const voice = async (content: string) => replyText(await (async () => {
      const res = await g.gw.app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { host: "localhost:7477", authorization: `Bearer ${g.gw.token}` }, payload: { content, inputMode: "voice" } });
      return res.body.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    })());
    expect(await voice("Ultron, forget that my favourite editor is Neovim")).toMatch(/don't delete memories from voice alone/);
    expect((await g.api("GET", "/api/memories")).body.memories).toHaveLength(1);
    await g.api("PUT", "/api/settings/provider", { provider: "anthropic", apiKey: "sk-ant-test-0123456789" });
    await g.api("PUT", "/api/settings/provider", { provider: "mock" });
    expect(await voice("Ultron, switch to Claude")).toMatch(/don't do that from voice alone/);
    expect((await g.api("GET", "/api/status")).body.provider).toBe("mock");
  });
});

describe("review fix #6: action flood cap", () => {
  it("runs at most 8 actions per reply", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    // The scripted mock repeats the same tool call 12 times when asked like this.
    const events = await g.chat(await g.newConversation(), "mock-flood create_reminder 12");
    expect(events.filter((e) => e.type === "tool")).toHaveLength(8);
    expect((await g.api("GET", "/api/reminders")).body.reminders).toHaveLength(8);
  });
});
