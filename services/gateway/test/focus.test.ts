import { afterEach, describe, expect, it } from "vitest";
import { claimsUnbackedAction, focusTools } from "../src/actions/focus.ts";
import { TOOLS } from "../src/actions/tools.ts";
import { replyText, startGateway } from "./helpers.ts";

const names = (texts: string[]) => focusTools(texts, TOOLS).map((t) => t.name).sort();

describe("tool focusing for small local models", () => {
  it("offers only the tools a message plausibly needs", () => {
    expect(names(["remind me in 10 minutes to stretch"])).toEqual(["cancel_reminder", "create_reminder", "list_reminders"]);
    expect(names(["what's 15% of 80?"])).toEqual(["calculate"]);
    expect(names(["will I need an umbrella?"])).toEqual(["get_weather"]);
    expect(names(["summarize https://example.com/a"])).toEqual(["open_website", "read_webpage"]);
    expect(names(["add milk to my list"])).toContain("add_todo");
    expect(names(["my sister's birthday is March 3"])).toEqual(["save_memory"]);
    expect(names(["tell me a joke"])).toEqual([]);
  });
  it("keeps the previous message's tools for follow-ups like 'yes, do it'", () => {
    expect(names(["open https://example.com", "yes please"])).toEqual(["open_website", "read_webpage"]);
  });
});

describe("honesty check", () => {
  it("spots replies that claim an action", () => {
    for (const t of [
      "Approval requested to open https://example.com in your browser.",
      "Approval required to open https://example.com in your browser.",
      "I've set a reminder for 5pm.",
      "Done! I have added milk to your list.",
      "I've initiated the request to open the website, waiting for your approval.",
      "I opened the page in your browser.",
    ])
      expect(claimsUnbackedAction(t), t).toBe(true);
    for (const t of ["I can set a reminder if you like.", "Want me to add that to your list?", "The capital of France is Paris.", "Should I open the website?"])
      expect(claimsUnbackedAction(t), t).toBe(false);
  });

  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!();
  });
  it("corrects a claimed action when no tool ran, and logs it", async () => {
    const g = await startGateway();
    cleanup.push(g.close);
    const id = await g.newConversation();
    // The test brain echoes the message, so this makes it "claim" something it never did.
    const text = replyText(await g.chat(id, "I've set a reminder for your dentist appointment"));
    expect(text).toMatch(/safety check: nothing was actually done/);
    expect((await g.api("GET", "/api/activity")).body.events.some((e: { action: string }) => e.action === "model.unbacked_claim")).toBe(true);
    // A real action in the same turn is not "corrected".
    expect(replyText(await g.chat(id, "add buy milk to my list"))).not.toMatch(/safety check/);
  });
});
