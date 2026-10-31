import { z } from "zod";
import type { ToolDef } from "./tools.ts";

const DueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const show = (t: { id: string; text: string; dueDate: string | null }) => ({ id: t.id.slice(0, 8), text: t.text, due: t.dueDate ?? undefined });

const addTodo: ToolDef<{ items: string[]; due_date?: string }> = {
  name: "add_todo",
  description: "Add one or more items to the owner's to-do list (e.g. 'add milk and eggs to my list' → two items). Use due_date only if they said when. Reversible: they can tick or delete items any time.",
  input: z.object({ items: z.array(z.string().trim().min(1).max(200)).min(1).max(10), due_date: DueDate.optional() }).strict(),
  parameters: {
    type: "object",
    properties: { items: { type: "array", items: { type: "string" }, description: "Short items, e.g. ['Buy milk', 'Call the bank']" }, due_date: { type: "string", description: "YYYY-MM-DD in local time, optional" } },
    required: ["items"],
    additionalProperties: false,
  },
  risk: 1,
  timeoutMs: 2000,
  describe: (i) => `Add to your to-do list: ${i.items.map((t) => `"${t}"`).join(", ")}${i.due_date ? ` (due ${i.due_date})` : ""}`,
  run: async (i, ctx) => {
    const open = ctx.stores.todos.list();
    const added = [];
    const skipped = [];
    for (const text of i.items) {
      const tidy = text.charAt(0).toUpperCase() + text.slice(1);
      if (open.some((t) => t.text.toLowerCase() === tidy.toLowerCase())) skipped.push(tidy);
      else added.push(show(ctx.stores.todos.add({ text: tidy, dueDate: i.due_date ?? null, conversationId: ctx.conversationId })));
    }
    return JSON.stringify({ ok: true, added, already_on_list: skipped.length ? skipped : undefined, open_items: ctx.stores.todos.list().length });
  },
};

const listTodos: ToolDef<{ include_done?: boolean }> = {
  name: "list_todos",
  description: "Show the owner's to-do list (open items, optionally also things finished this week).",
  input: z.object({ include_done: z.boolean().optional() }).strict(),
  parameters: { type: "object", properties: { include_done: { type: "boolean" } }, additionalProperties: false },
  risk: 0,
  timeoutMs: 2000,
  describe: () => "Check your to-do list",
  run: async (i, ctx) => {
    const all = ctx.stores.todos.list({ includeDone: i.include_done });
    return JSON.stringify({
      open: all.filter((t) => !t.doneAt).map(show),
      finished_this_week: i.include_done ? all.filter((t) => t.doneAt).map((t) => t.text) : undefined,
    });
  },
};

const completeTodo: ToolDef<{ item: string }> = {
  name: "complete_todo",
  description: "Tick off an item on the owner's to-do list when they say they did it ('I paid the electric bill'). Give their words or the item id from list_todos. If it's ambiguous you'll get the candidates back: ask which one.",
  input: z.object({ item: z.string().trim().min(1).max(200) }).strict(),
  parameters: { type: "object", properties: { item: { type: "string", description: "The item's words or its 8-character id" } }, required: ["item"], additionalProperties: false },
  risk: 1,
  timeoutMs: 2000,
  describe: (i) => `Tick off "${i.item}" on your to-do list`,
  run: async (i, ctx) => {
    const open = ctx.stores.todos.list();
    const byId = open.filter((t) => t.id.startsWith(i.item.toLowerCase()));
    const exact = open.filter((t) => t.text.toLowerCase() === i.item.toLowerCase());
    const matches = byId.length === 1 ? byId : exact.length === 1 ? exact : ctx.stores.todos.match(i.item);
    if (!matches.length) return JSON.stringify({ ok: false, note: "Nothing on the open list matches that.", open: open.map(show) });
    if (matches.length > 1) return JSON.stringify({ ok: false, ambiguous: true, note: "Several items match; ask the owner which one.", candidates: matches.map(show) });
    const done = ctx.stores.todos.setDone(matches[0]!.id, true)!;
    return JSON.stringify({ ok: true, ticked_off: done.text, still_open: ctx.stores.todos.list().length });
  },
};

export const TODO_TOOLS: ToolDef[] = [addTodo, listTodos, completeTodo];
