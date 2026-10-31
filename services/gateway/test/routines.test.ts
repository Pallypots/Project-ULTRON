import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { replyText, startGateway, tmpDataDir } from "./helpers.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  delete process.env.ULTRON_START_MENU_DIRS;
  delete process.env.ULTRON_ACTIONS_DRY_RUN;
  while (cleanup.length) await cleanup.pop()!();
});

describe("routines", () => {
  it("runs each step by one phrase, keeps approvals for risky steps, and explains steps it can't run", async () => {
    const menu = join(tmpDataDir(), "menu");
    mkdirSync(menu);
    writeFileSync(join(menu, "Notepad.lnk"), "");
    process.env.ULTRON_START_MENU_DIRS = menu;
    process.env.ULTRON_ACTIONS_DRY_RUN = "1";
    const g = await startGateway();
    cleanup.push(g.close);
    const examples = (await g.api("GET", "/api/routines")).body.examples;
    expect(examples.map((e: { name: string }) => e.name)).toContain("Good night");
    const saved = await g.api("PUT", "/api/routines", {
      routines: [
        { id: "r1", name: "Wind down", phrases: ["wind down", "time to relax"], steps: ["add stretch to my list", "what's on my list", "open notepad", "remind me in 30 minutes to sleep", "write me a poem"], enabled: true },
        { id: "r2", name: "Off one", phrases: ["disabled phrase"], steps: ["what's on my list"], enabled: false },
      ],
    });
    expect(saved.status).toBe(200);
    const id = await g.newConversation();
    const events = await g.chat(id, "Ultron, time to relax!");
    const text = replyText(events);
    expect(text).toMatch(/^Wind down:\n• Added to your list: Stretch\. 1 open item now\.\n• On your list \(1\):\n   • Stretch\n• Opening apps needs your OK.*\n• Reminder set: "sleep" in 30 minutes\.\n• Skipped "write me a poem"/);
    const tools = events.filter((e) => e.type === "tool").map((e: any) => `${e.event.tool}:${e.event.status}`);
    expect(tools).toEqual(["add_todo:succeeded", "list_todos:succeeded", "open_app:awaiting_approval", "create_reminder:succeeded"]);
    // Disabled routines and near-misses go to the brain as normal chat.
    expect(replyText(await g.chat(id, "disabled phrase"))).toMatch(/Offline mock mode/);
    expect(replyText(await g.chat(id, "time to relax a bit more"))).toMatch(/Offline mock mode/);
    expect((await g.api("PUT", "/api/routines", { routines: [{ id: "x", name: "", phrases: [], steps: [] }] })).status).toBe(400);
  });
});
