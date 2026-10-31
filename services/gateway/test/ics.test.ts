import { describe, expect, it } from "vitest";
import { eventsBetween, parseIcs } from "../src/calendar/ics.ts";

// Fixture lines are indented for readability; a leading "~" marks a folded continuation line (which starts with a space).
const cal = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap((e) => ["BEGIN:VEVENT", ...e.trim().split("\n").map((l) => l.replace(/^\s+/, "").replace(/^~/, " ")), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
const iso = (d: Date) => d.toISOString().slice(0, 16);
const between = (ics: string, from: string, to: string) => eventsBetween(parseIcs(ics), new Date(from), new Date(to));

describe("iCal reader", () => {
  it("reads single events in UTC and in a named time zone (DST-correct), with folded lines and escapes", () => {
    const ics = cal(
      `UID:1
       SUMMARY:Dentist\\, Dr. Smith
       LOCATION:12 Main St
       DTSTART:20261102T150000Z
       DTEND:20261102T160000Z`,
      `UID:2
       SUMMARY:Standup with a very long title that the 
       ~calendar folded onto a second line
       DTSTART;TZID=America/New_York:20261030T090000
       DURATION:PT30M`,
      `UID:3
       SUMMARY:After clocks change
       DTSTART;TZID=Eastern Standard Time:20261102T090000
       DTEND;TZID=Eastern Standard Time:20261102T093000`,
    );
    const ev = between(ics, "2026-10-29T00:00:00Z", "2026-11-05T00:00:00Z");
    expect(ev.map((e) => [e.title, iso(e.start), iso(e.end)])).toEqual([
      ["Standup with a very long title that the calendar folded onto a second line", "2026-10-30T13:00", "2026-10-30T13:30"], // EDT = UTC-4
      ["After clocks change", "2026-11-02T14:00", "2026-11-02T14:30"], // EST = UTC-5 (Windows zone name)
      ["Dentist, Dr. Smith", "2026-11-02T15:00", "2026-11-02T16:00"],
    ]);
    expect(ev[2]!.location).toBe("12 Main St");
  });

  it("expands weekly repeats on chosen weekdays, skips excluded and moved occurrences, honours COUNT and UNTIL", () => {
    const ics = cal(
      `UID:gym
       SUMMARY:Gym
       DTSTART;TZID=America/New_York:20261005T070000
       DTEND;TZID=America/New_York:20261005T080000
       RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
       EXDATE;TZID=America/New_York:20261028T070000`,
      `UID:gym
       RECURRENCE-ID;TZID=America/New_York:20261030T070000
       SUMMARY:Gym (moved)
       DTSTART;TZID=America/New_York:20261031T100000
       DTEND;TZID=America/New_York:20261031T110000`,
      `UID:class
       SUMMARY:Pottery
       DTSTART:20261001T230000Z
       DTEND:20261002T000000Z
       RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3`,
      `UID:old
       SUMMARY:Ended series
       DTSTART:20260101T120000Z
       RRULE:FREQ=WEEKLY;UNTIL=20260301T000000Z`,
    );
    const ev = between(ics, "2026-10-26T00:00:00Z", "2026-11-02T00:00:00Z");
    expect(ev.map((e) => `${e.title} ${iso(e.start)}`)).toEqual([
      "Gym 2026-10-26T11:00", // Monday; Wednesday the 28th is excluded; Friday the 30th was moved
      "Gym (moved) 2026-10-31T14:00",
    ]);
    expect(between(ics, "2026-10-01T00:00:00Z", "2026-10-10T00:00:00Z").filter((e) => e.title === "Pottery").map((e) => iso(e.start))).toEqual([
      "2026-10-01T23:00",
      "2026-10-03T23:00",
      "2026-10-05T23:00",
    ]);
  });

  it("handles all-day events, monthly 'second Tuesday', yearly birthdays and cancelled events", () => {
    const ics = cal(
      `UID:a
       SUMMARY:Halloween
       DTSTART;VALUE=DATE:20261031
       DTEND;VALUE=DATE:20261101`,
      `UID:b
       SUMMARY:Book club
       DTSTART:20260113T190000Z
       DURATION:PT2H
       RRULE:FREQ=MONTHLY;BYDAY=2TU`,
      `UID:c
       SUMMARY:Mia's birthday
       DTSTART;VALUE=DATE:20000303
       RRULE:FREQ=YEARLY`,
      `UID:d
       SUMMARY:Cancelled meeting
       STATUS:CANCELLED
       DTSTART:20261031T150000Z`,
    );
    const oct = between(ics, "2026-10-30T00:00:00Z", "2026-11-12T00:00:00Z");
    expect(oct.map((e) => `${e.title} ${e.allDay ? "all-day" : iso(e.start)}`)).toEqual(["Halloween all-day", "Book club 2026-11-10T19:00"]);
    expect(between(ics, "2027-03-01T00:00:00Z", "2027-03-05T00:00:00Z").map((e) => e.title)).toEqual(["Mia's birthday"]);
  });

  it("survives junk", () => {
    expect(parseIcs("not a calendar")).toEqual([]);
    expect(between(cal("UID:x\nSUMMARY:No date"), "2026-01-01", "2027-01-01")).toEqual([]);
  });
});
