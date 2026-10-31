import { describe, expect, it } from "vitest";
import { openStores } from "@ultron/memory";
import { EventBus } from "../src/actions/events.ts";
import { MorningCheckIn } from "../src/checkin.ts";

const at = (h: number, m = 0, dayOffset = 0) => () => {
  const d = new Date(2026, 10, 2 + dayOffset, h, m);
  return d;
};

describe("morning check-in (ULTRON reaches out first)", () => {
  it("fires once a morning at the chosen time, with the day at a glance", async () => {
    const s = openStores(":memory:");
    const bus = new EventBus();
    const seen: any[] = [];
    bus.subscribe((e) => seen.push(e));
    s.todos.add({ text: "Renew passport", dueDate: "2026-11-02" });
    s.todos.add({ text: "Someday", dueDate: "2026-12-25" });
    s.reminders.create({ text: "Call mum", dueAt: new Date(2026, 10, 2, 18, 0), source: "manual" });
    expect(await new MorningCheckIn(s, bus, undefined, at(7, 59)).tick()).toBe(false); // too early
    expect(await new MorningCheckIn(s, bus, undefined, at(8, 5)).tick()).toBe(true);
    expect(seen.at(-1)).toEqual({ type: "checkin", title: "Good morning", body: "Today: 1 to-do due, 1 reminder later.", kind: "morning" });
    expect(await new MorningCheckIn(s, bus, undefined, at(9, 30)).tick()).toBe(false); // already done today
    expect(await new MorningCheckIn(s, bus, undefined, at(8, 1, 1)).tick()).toBe(true); // next day
  });

  it("never after noon, respects the owner's time, and can be turned off", async () => {
    const s = openStores(":memory:");
    const bus = new EventBus();
    expect(await new MorningCheckIn(s, bus, undefined, at(13, 0)).tick()).toBe(false);
    s.preferences.set("checkin", { enabled: true, time: "09:30" });
    expect(await new MorningCheckIn(s, bus, undefined, at(9, 0)).tick()).toBe(false);
    expect(await new MorningCheckIn(s, bus, undefined, at(9, 45)).tick()).toBe(true);
    s.preferences.set("checkin", { enabled: false, time: "09:30" });
    expect(await new MorningCheckIn(s, bus, undefined, at(9, 45, 1)).tick()).toBe(false);
  });

  it("asks how the day went once an evening, and can be turned off", async () => {
    const s = openStores(":memory:");
    const bus = new EventBus();
    const seen: any[] = [];
    bus.subscribe((e) => seen.push(e));
    s.preferences.set("checkin", { enabled: false });
    s.todos.add({ text: "Call mum" });
    expect(await new MorningCheckIn(s, bus, undefined, at(20, 59)).tick()).toBe(false);
    expect(await new MorningCheckIn(s, bus, undefined, at(21, 5)).tick()).toBe(true);
    expect(seen.at(-1)).toMatchObject({ type: "checkin", kind: "evening", title: "Evening check-in", body: expect.stringMatching(/today.*\(1 thing still on your list\.\)$/i) });
    expect(await new MorningCheckIn(s, bus, undefined, at(22, 0)).tick()).toBe(false);
    s.preferences.set("checkin", { enabled: false, evening: false });
    expect(await new MorningCheckIn(s, bus, undefined, at(21, 5, 1)).tick()).toBe(false);
  });
});

describe("calendar heads-up", () => {
  it("alerts once shortly before each timed event, skips all-day events, and can be turned off", async () => {
    const s = openStores(":memory:");
    const bus = new EventBus();
    const seen: any[] = [];
    bus.subscribe((e) => seen.push(e));
    s.preferences.set("checkin", { enabled: false, evening: false });
    const now = at(14, 52);
    const start = new Date(2026, 10, 2, 15, 0);
    const calendar = {
      connected: true,
      events: async (from: Date, to: Date) =>
        [
          { title: "Dentist", start, end: new Date(2026, 10, 2, 16, 0), allDay: false, location: "12 Main St" },
          { title: "Holiday", start: new Date(2026, 10, 2), end: new Date(2026, 10, 3), allDay: true },
        ].filter((e) => e.start < to && e.end > from),
    } as never;
    const c = new MorningCheckIn(s, bus, calendar, now);
    expect(await c.meetings()).toBe(1);
    expect(seen.at(-1)).toEqual({ type: "checkin", kind: "meeting", title: "📅 In 8 min", body: "Dentist (12 Main St)" });
    expect(await c.meetings()).toBe(0); // once per event
    s.preferences.set("checkin", { enabled: false, evening: false, meetingAlertMinutes: 0 });
    expect(await new MorningCheckIn(s, bus, calendar, now).meetings()).toBe(0);
  });
});
