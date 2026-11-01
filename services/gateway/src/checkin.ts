import type { Stores } from "@ultron/memory";
import type { EventBus } from "./actions/events.ts";
import { dayRange, type CalendarService } from "./calendar/service.ts";
import { rainSoon } from "./actions/knowledge.ts";

export interface CheckInSettings {
  enabled: boolean;
  /** Local time, "HH:MM". */
  time: string;
  /** Minutes before calendar events to give a heads-up (0 = off). */
  meetingAlertMinutes: number;
  /** Evening "how did today go?" check-in. */
  evening: boolean;
  eveningTime: string;
  /** A heads-up when rain is likely in the next couple of hours (needs the home city). */
  rainAlerts: boolean;
}
export const DEFAULT_CHECKIN: CheckInSettings = { enabled: true, time: "08:00", evening: true, eveningTime: "21:00", meetingAlertMinutes: 10, rainAlerts: true };

// Varied so it doesn't feel like a cron job.
const EVENING_LINES = [
  "How did today go? I'm all ears (well, microphones).",
  "Day's nearly done. Anything worth telling me about?",
  "Evening. How was today? Wins, disasters, both?",
  "Got a minute? Tell me how today went.",
];

/**
 * ULTRON reaches out first once a morning: at the owner's chosen time (or when ULTRON starts later that morning) it
 * pops up a short "here's your day" with a button for the full briefing. Never after noon, never twice a day.
 */
export class MorningCheckIn {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private stores: Stores,
    private bus: EventBus,
    private calendar?: CalendarService,
    private now: () => Date = () => new Date(),
  ) {}

  settings(): CheckInSettings {
    return { ...DEFAULT_CHECKIN, ...this.stores.preferences.get<Partial<CheckInSettings>>("checkin", {}) };
  }

  start() {
    if (process.env.ULTRON_CHECKIN === "off") return; // automated tests
    this.timer ??= setInterval(() => void this.tick().catch(() => {}), 60_000);
    this.timer.unref?.();
    setTimeout(() => void this.tick().catch(() => {}), 5000).unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sends today's check-ins if they're due. Returns whether one was sent. */
  async tick(): Promise<boolean> {
    await this.meetings();
    await this.rain().catch(() => false);
    return (await this.morning()) || this.evening();
  }

  private alerted = new Set<string>();

  /** A heads-up shortly before calendar events (each event once). */
  async meetings(): Promise<number> {
    const mins = this.settings().meetingAlertMinutes;
    if (!mins || !this.calendar?.connected) return 0;
    const now = this.now();
    const soon = await this.calendar.events(now, new Date(now.getTime() + mins * 60_000)).catch(() => []);
    let n = 0;
    for (const e of soon) {
      if (e.allDay || e.start.getTime() < now.getTime()) continue;
      const key = `${e.title}@${e.start.toISOString()}`;
      if (this.alerted.has(key)) continue;
      this.alerted.add(key);
      const inMin = Math.max(1, Math.round((e.start.getTime() - now.getTime()) / 60_000));
      this.bus.emit({ type: "checkin", title: `📅 In ${inMin} min`, body: `${e.title}${e.location ? ` (${e.location})` : ""}`, kind: "meeting" });
      n++;
    }
    return n;
  }

  private rainCheckedAt = 0;
  /** "Rain likely around 3pm, take an umbrella": at most every 6 hours, daytime only, only if it isn't raining already. */
  async rain(): Promise<boolean> {
    const s = this.settings();
    const place = this.stores.preferences.get<string>("home_location", "").trim();
    if (!s.rainAlerts || !place) return false;
    const now = this.now();
    if (now.getHours() < 7 || now.getHours() >= 22) return false;
    if (now.getTime() - this.rainCheckedAt < 30 * 60_000) return false;
    this.rainCheckedAt = now.getTime();
    const last = this.stores.preferences.get<number>("checkin_rain_last", 0);
    if (now.getTime() - last < 6 * 3600_000) return false;
    const r = await rainSoon(place);
    if (!r || r.rainingNow) return false;
    const wet = r.hours.find((h) => h.chance >= 70);
    if (!wet) return false;
    this.stores.preferences.set("checkin_rain_last", now.getTime());
    const when = new Date(wet.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    this.stores.audit.record("checkin.rain_sent", "system", null, { chance: wet.chance });
    this.bus.emit({ type: "checkin", title: "🌧 Rain on the way", body: `${wet.chance}% chance of rain in ${r.place} around ${when}. Umbrella advised; rust is not a good look.`, kind: "weather" });
    return true;
  }

  /** "How did today go?" once an evening (not after midnight, and only if ULTRON is running then). */
  evening(): boolean {
    const s = this.settings();
    if (!s.evening) return false;
    const now = this.now();
    const today = now.toLocaleDateString("en-CA");
    if (this.stores.preferences.get<string>("checkin_evening_last", "") === today) return false;
    const [h, m] = s.eveningTime.split(":").map(Number) as [number, number];
    if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;
    this.stores.preferences.set("checkin_evening_last", today);
    const open = this.stores.todos.list().length;
    const body = EVENING_LINES[now.getDate() % EVENING_LINES.length]! + (open ? ` (${open} thing${open > 1 ? "s" : ""} still on your list.)` : "");
    this.stores.audit.record("checkin.evening_sent", "system");
    this.bus.emit({ type: "checkin", title: "Evening check-in", body, kind: "evening" });
    return true;
  }

  private async morning(): Promise<boolean> {
    const s = this.settings();
    if (!s.enabled) return false;
    const now = this.now();
    const today = now.toLocaleDateString("en-CA");
    if (this.stores.preferences.get<string>("checkin_last", "") === today) return false;
    const [h, m] = s.time.split(":").map(Number) as [number, number];
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < h * 60 + m || now.getHours() >= 12) return false;
    this.stores.preferences.set("checkin_last", today);

    const parts: string[] = [];
    if (this.calendar?.connected) {
      const { from, to } = dayRange(0);
      const ev = await Promise.race([this.calendar.events(from, to).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
      if (ev) parts.push(ev.length ? `${ev.length} event${ev.length > 1 ? "s" : ""} today, first: ${ev[0]!.title}` : "a clear calendar");
    }
    const due = this.stores.todos.list().filter((t) => t.dueDate && t.dueDate <= today);
    if (due.length) parts.push(`${due.length} to-do${due.length > 1 ? "s" : ""} due`);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const reminders = this.stores.reminders.upcoming().filter((r) => new Date(r.dueAt) <= endOfDay);
    if (reminders.length) parts.push(`${reminders.length} reminder${reminders.length > 1 ? "s" : ""} later`);
    const body = parts.length ? `Today: ${parts.join(", ")}.` : "Nothing urgent on the radar. Want the full briefing anyway?";
    this.stores.audit.record("checkin.sent", "system", null, { items: parts.length });
    this.bus.emit({ type: "checkin", title: "Good morning", body, kind: "morning" });
    return true;
  }
}
