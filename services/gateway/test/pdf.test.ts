import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pdfText } from "../src/files/pdf.ts";
import { makePdf } from "./fixtures/pdf.ts";
import { replyText, startGateway, tmpDataDir } from "./helpers.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("PDF text in the second brain", () => {
  it("reads text from a PDF and copes with broken files", async () => {
    expect(await pdfText(makePdf(["Invoice for Mike Johnson", "Total due: $450"]), 1000)).toMatch(/Invoice for Mike Johnson\s+Total due: \$450/);
    expect(await pdfText(new TextEncoder().encode("%PDF-1.4 this is not really a pdf"), 1000)).toBeNull();
    expect(await pdfText(new Uint8Array([0, 1, 2]), 1000)).toBeNull();
  });

  it("indexes PDFs in approved folders, so search and read work on them", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const root = mkdtempSync(join(tmpDataDir(), "docs-"));
    writeFileSync(join(root, "invoice-2026-10.pdf"), makePdf(["Invoice for Mike Johnson", "Roof repair, total due: $450"]));
    const add = await g.api("POST", "/api/files/folders", { path: root });
    expect(add.status).toBe(200);
    for (let i = 0; i < 50 && (await g.api("GET", "/api/files/folders")).body.indexing; i++) await new Promise((r) => setTimeout(r, 100));
    const found = replyText(await g.chat(await g.newConversation(), "search my files for roof repair"));
    expect(found).toMatch(/invoice-2026-10\.pdf/);
    const fileId = /"file_id":"([^"]+)"/.exec(found)![1];
    expect(replyText(await g.chat(await g.newConversation(), `mock-tool read_file {"file_id":"${fileId}"}`))).toMatch(/untrusted_file_content.*Mike Johnson.*\$450/);
  });
});
