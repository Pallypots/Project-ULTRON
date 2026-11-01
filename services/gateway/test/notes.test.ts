import { afterEach, describe, expect, it } from "vitest";
import { detectQuickCommand } from "@ultron/agent-core";
import { replyText, startGateway } from "./helpers.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("notes", () => {
  it("understands note commands", () => {
    expect(detectQuickCommand("Ultron, take a note: the boiler code is in the blue folder")).toEqual({ type: "add_note", text: "the boiler code is in the blue folder" });
    expect(detectQuickCommand("jot down buy a new kettle")).toEqual({ type: "add_note", text: "buy a new kettle" });
    expect(detectQuickCommand("read my notes")).toEqual({ type: "list_notes", query: null });
    expect(detectQuickCommand("what did I note about kettles?")).toEqual({ type: "list_notes", query: "kettles" });
  });

  it("saves dictated notes instantly, finds them later, and lists them in the app", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const id = await g.newConversation();
    expect(replyText(await g.chat(id, "read my notes"))).toMatch(/No notes yet/);
    expect(replyText(await g.chat(id, "take a note: the boiler manual is in the blue folder"))).toBe('Noted: "The boiler manual is in the blue folder". You have 1 note (Reminders page → Notes).');
    expect(replyText(await g.chat(id, "jot down buy a new kettle"))).toMatch(/You have 2 notes/);
    const found = replyText(await g.chat(id, "what did I note about kettles?"));
    expect(found).toMatch(/^Notes about "kettles" \(1\):\n• Buy a new kettle/);
    expect(found).not.toContain("boiler");
    const notes = (await g.api("GET", "/api/notes")).body.notes;
    expect(notes.map((n: { text: string }) => n.text)).toEqual(["Buy a new kettle", "The boiler manual is in the blue folder"]);
    expect((await g.api("DELETE", `/api/notes/${notes[0].id}`)).body.ok).toBe(true);
    expect((await g.api("GET", "/api/memories/export")).body.notes).toHaveLength(1);
  });
});
