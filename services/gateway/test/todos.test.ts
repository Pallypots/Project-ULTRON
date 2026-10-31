import { afterEach, describe, expect, it } from "vitest";
import { replyText, startGateway } from "./helpers.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
const gateway = async () => {
  const g = await startGateway();
  cleanup.push(g.close);
  return g;
};
const tool = (events: any[]) => events.find((e) => e.type === "tool")?.event;

describe("to-do list", () => {
  it("adds several items from one sentence, skips duplicates, lists and ticks them off by description", async () => {
    const g = await gateway();
    const id = await g.newConversation();
    const add = await g.chat(id, "add pay the electric bill, buy milk and call mum to my list");
    expect(tool(add)).toMatchObject({ tool: "add_todo", status: "succeeded", risk: 1 });
    expect((await g.api("GET", "/api/todos")).body.todos.map((t: any) => t.text)).toEqual(["Pay the electric bill", "Buy milk", "Call mum"]);
    expect(replyText(await g.chat(id, "add buy milk to my list"))).toContain('"already_on_list":["Buy milk"]');

    expect(replyText(await g.chat(id, "what's on my list?"))).toMatch(/"open":\[.*Pay the electric bill.*Buy milk.*Call mum/);
    const done = await g.chat(id, "I paid the electric bill");
    expect(tool(done)).toMatchObject({ tool: "complete_todo", status: "succeeded" });
    expect(replyText(done)).toContain('"ticked_off":"Pay the electric bill"');
    const todos = (await g.api("GET", "/api/todos")).body.todos;
    expect(todos.filter((t: any) => !t.doneAt).map((t: any) => t.text)).toEqual(["Buy milk", "Call mum"]);
    expect(todos.find((t: any) => t.text === "Pay the electric bill").doneAt).toBeTruthy();
  });

  it("asks instead of guessing when several items match, and says when nothing does", async () => {
    const g = await gateway();
    const id = await g.newConversation();
    await g.chat(id, "add email the landlord, email the plumber to my list");
    const both = replyText(await g.chat(id, 'mock-tool complete_todo {"item":"email"}'));
    expect(both).toMatch(/"ambiguous":true.*landlord.*plumber/);
    expect(replyText(await g.chat(id, 'mock-tool complete_todo {"item":"walk the dog"}'))).toMatch(/Nothing on the open list matches/);
    expect((await g.api("GET", "/api/todos")).body.todos.every((t: any) => !t.doneAt)).toBe(true);
  });

  it("is editable in the app and shows up in the morning briefing", async () => {
    const g = await gateway();
    const add = await g.api("POST", "/api/todos", { text: "Renew passport", dueDate: "2026-11-15" });
    expect(add.body.todo).toMatchObject({ text: "Renew passport", dueDate: "2026-11-15", doneAt: null });
    expect((await g.api("POST", "/api/todos", { text: "" })).status).toBe(400);
    expect((await g.api("POST", "/api/todos", { text: "x", dueDate: "next week" })).status).toBe(400);
    expect(replyText(await g.chat(await g.newConversation(), "good morning"))).toContain('"todo_list":["Renew passport (due 2026-11-15)"]');
    const id = add.body.todo.id;
    expect((await g.api("PATCH", `/api/todos/${id}`, { done: true })).body.todo.doneAt).toBeTruthy();
    expect((await g.api("PATCH", `/api/todos/${id}`, { done: false, text: "Renew passport (book photo)" })).body.todo).toMatchObject({ doneAt: null, text: "Renew passport (book photo)" });
    expect((await g.api("DELETE", `/api/todos/${id}`)).status).toBe(200);
    expect((await g.api("DELETE", `/api/todos/${id}`)).status).toBe(404);
  });

  it("stops low-risk list changes when actions are paused, but still reads the list", async () => {
    const g = await gateway();
    await g.api("PUT", "/api/settings/actions", { paused: true, confirmLowRisk: false });
    const id = await g.newConversation();
    expect(tool(await g.chat(id, "add buy milk to my list"))).toMatchObject({ tool: "add_todo", status: "denied" });
    expect(tool(await g.chat(id, "what's on my list?"))).toMatchObject({ tool: "list_todos", status: "succeeded" });
  });
});
