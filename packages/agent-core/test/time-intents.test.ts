import { describe, expect, it } from "vitest";
import { detectTimeIntent, parseClock, parseDurationMs } from "../src/index.ts";

// Thursday 2026-10-29, 14:20 local time.
const NOW = new Date(2026, 9, 29, 14, 20, 0);
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 29 + dayOffset, h, m, 0, 0).getTime();

describe("durations and clock times", () => {
  it.each([
    ["10 minutes", 600_000],
    ["an hour", 3_600_000],
    ["1 hour and 30 minutes", 5_400_000],
    ["half an hour", 1_800_000],
    ["90 seconds", 90_000],
    ["two hours", 7_200_000],
  ])("%s", (t, ms) => expect(parseDurationMs(t)).toBe(ms));

  it.each([
    ["5pm", at(17)],
    ["at 5:30 pm", at(17, 30)],
    ["at 9am", at(9, 0, 1)],
    ["17:45", at(17, 45)],
    ["at 3", at(15)],
    ["at 11", at(23)],
    ["tomorrow at 9", at(9, 0, 1)],
    ["noon", at(12, 0, 1)],
    ["tonight at 8", at(20)],
    ["12am", at(0, 0, 1)],
  ])("%s", (t, expected) => expect(parseClock(t, NOW)?.getTime()).toBe(expected));
});

describe("reminder commands", () => {
  const r = (msg: string) => detectTimeIntent(msg, NOW);
  it("relative reminders, either order", () => {
    expect(r("Remind me in 10 minutes to take the pizza out")).toMatchObject({ type: "reminder", text: "take the pizza out", label: "in 10 minutes" });
    expect(r("Ultron, remind me to stretch in half an hour.")).toMatchObject({ text: "stretch", due: new Date(NOW.getTime() + 1_800_000) });
  });
  it("clock reminders", () => {
    expect(r("remind me at 5pm to call mom")).toMatchObject({ text: "call mom", due: new Date(at(17)) });
    expect(r("remind me tomorrow at 9am to send the invoice")).toMatchObject({ text: "send the invoice", due: new Date(at(9, 0, 1)) });
    expect(r("remind me to check the build at 6:15 pm")).toMatchObject({ text: "check the build", due: new Date(at(18, 15)) });
    expect(r("remind me to water the plants tomorrow")).toMatchObject({ due: new Date(at(9, 0, 1)) });
  });
  it("timers", () => {
    expect(r("set a timer for 5 minutes")).toMatchObject({ type: "reminder", text: "Your 5-minute timer is done", due: new Date(NOW.getTime() + 300_000) });
    expect(r("start a 10 minute timer")).toMatchObject({ due: new Date(NOW.getTime() + 600_000) });
  });
  it("list and cancel", () => {
    expect(r("what are my reminders?")).toEqual({ type: "list_reminders" });
    expect(r("do I have any timers")).toEqual({ type: "list_reminders" });
    expect(r("cancel my reminder to call mom")).toEqual({ type: "cancel_reminder", query: "call mom" });
    expect(r("cancel the timer")).toEqual({ type: "cancel_reminder", query: "" });
  });
  it("ignores ordinary sentences", () => {
    for (const s of ["what time is it", "remind me what we talked about", "my reminders app is broken, any ideas?", "remember to buy milk"]) expect(r(s)).toBeNull();
  });
});
