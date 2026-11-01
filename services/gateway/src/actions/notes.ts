import { z } from "zod";
import type { ToolDef } from "./tools.ts";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const addNote: ToolDef<{ text: string }> = {
  name: "add_note",
  description: "Save a note the owner dictates ('take a note: …', 'jot down …', 'note that …'). Notes are for things to look up later; facts about the owner themselves go in memory instead.",
  input: z.object({ text: z.string().trim().min(2).max(2000) }).strict(),
  parameters: { type: "object", properties: { text: { type: "string", description: "The note, in the owner's words" } }, required: ["text"], additionalProperties: false },
  risk: 1,
  timeoutMs: 2000,
  describe: (i) => `Save a note: "${i.text.length > 80 ? `${i.text.slice(0, 80)}…` : i.text}"`,
  run: async (i, ctx) => {
    const n = ctx.stores.notes.add({ text: i.text.charAt(0).toUpperCase() + i.text.slice(1), conversationId: ctx.conversationId });
    return JSON.stringify({ ok: true, saved: n.text, total_notes: ctx.stores.notes.list(10_000).length });
  },
};

const listNotes: ToolDef<{ query?: string }> = {
  name: "list_notes",
  description: "Read the owner's notes, newest first, or search them ('what did I note about the boiler?').",
  input: z.object({ query: z.string().trim().max(200).optional() }).strict(),
  parameters: { type: "object", properties: { query: { type: "string", description: "Words to look for (optional)" } }, additionalProperties: false },
  risk: 0,
  timeoutMs: 2000,
  describe: (i) => (i.query ? `Search your notes for "${i.query}"` : "Read your notes"),
  run: async (i, ctx) => {
    const notes = i.query ? ctx.stores.notes.search(i.query, 15) : ctx.stores.notes.list(15);
    return JSON.stringify({ count: notes.length, notes: notes.map((n) => ({ when: when(n.createdAt), untrusted_text: n.text })), note: notes.length ? undefined : i.query ? "No notes match." : "No notes yet." });
  },
};

export const NOTE_TOOLS: ToolDef[] = [addNote, listNotes];
