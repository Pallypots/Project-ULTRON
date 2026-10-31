import type { Stores } from "@ultron/memory";
import type { SecretStore } from "../secrets.ts";
import { assertPublic, reach } from "../actions/knowledge.ts";
import { eventsBetween, parseIcs, type CalEvent } from "./ics.ts";

export const CALENDAR_SECRET = "ULTRON_CALENDAR_ICS";
const CACHE_MS = 10 * 60_000;
const MAX_BYTES = 5_000_000;

export class CalendarError extends Error {}

/** Normalises a pasted iCal link: webcal:// becomes https://, plain http is refused (the link is a secret). */
export function normaliseIcsUrl(raw: string): URL {
  const s = raw.trim().replace(/^webcals?:\/\//i, "https://");
  const testing = process.env.ULTRON_ALLOW_PRIVATE_FETCH === "1" && /^http:\/\/127\.0\.0\.1:/.test(s); // local test calendars only
  if (!/^https:\/\//i.test(s) && !testing) throw new CalendarError("Paste the calendar's private address in iCal format (it starts with https:// or webcal://).");
  try {
    return new URL(s);
  } catch {
    throw new CalendarError("That doesn't look like a web address.");
  }
}

/**
 * Read-only calendar from the owner's private iCal link (Google: Settings → your calendar → "Secret address in iCal format";
 * Outlook: Settings → Shared calendars → Publish → ICS). The link is stored encrypted like other secrets and never shown again.
 */
export class CalendarService {
  private cache: { at: number; text: string } | null = null;
  lastError: string | null = null;
  lastSyncAt: string | null = null;

  constructor(
    private stores: Stores,
    private secrets: SecretStore,
  ) {}

  get connected() {
    return this.secrets.has(CALENDAR_SECRET);
  }

  /** Checks the link really returns a calendar before saving it. */
  async connect(raw: string): Promise<{ events: number }> {
    const url = normaliseIcsUrl(raw);
    const text = await this.download(url, process.env.ULTRON_ALLOW_PRIVATE_FETCH === "1");
    const count = parseIcs(text).length;
    this.secrets.set(CALENDAR_SECRET, url.toString());
    this.cache = { at: Date.now(), text };
    this.lastSyncAt = new Date().toISOString();
    this.lastError = null;
    return { events: count };
  }

  disconnect() {
    this.secrets.set(CALENDAR_SECRET, null);
    this.cache = null;
    this.lastError = null;
    this.lastSyncAt = null;
  }

  private async download(url: URL, allowPrivate = false): Promise<string> {
    if (!allowPrivate) await assertPublic(url);
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const res = await reach(current, { redirect: "manual", headers: { accept: "text/calendar,*/*;q=0.5", "user-agent": "ULTRON-personal-assistant" }, signal: AbortSignal.timeout(15_000) });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current);
        if (current.protocol !== "https:") throw new CalendarError("The calendar redirected to an insecure address.");
        if (!allowPrivate) await assertPublic(current);
        continue;
      }
      if (res.status === 404 || res.status === 403 || res.status === 401) throw new CalendarError("The calendar service refused that link. It may have been reset; copy the private iCal address again.");
      if (!res.ok) throw new CalendarError(`The calendar service answered ${res.status}.`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new CalendarError("That calendar is too large to read (over 5 MB).");
      const text = new TextDecoder().decode(buf);
      if (!text.includes("BEGIN:VCALENDAR")) throw new CalendarError("That link didn't return a calendar. Use the address in iCal format (it usually ends in .ics).");
      return text;
    }
    throw new CalendarError("The calendar link redirects too many times.");
  }

  /** Events overlapping [from, to). Uses a 10-minute cache; on a network error, the last good copy is used. */
  async events(from: Date, to: Date): Promise<CalEvent[]> {
    const link = this.secrets.get(CALENDAR_SECRET);
    if (!link) throw new CalendarError("No calendar is connected. Add it in Connections → Calendar.");
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      try {
        this.cache = { at: Date.now(), text: await this.download(new URL(link), process.env.ULTRON_ALLOW_PRIVATE_FETCH === "1") };
        this.lastSyncAt = new Date().toISOString();
        this.lastError = null;
      } catch (err) {
        this.lastError = (err as Error).message;
        if (!this.cache) throw err;
      }
    }
    return eventsBetween(parseIcs(this.cache.text), from, to);
  }

  status() {
    return { connected: this.connected, lastSyncAt: this.lastSyncAt, error: this.lastError };
  }
}

/** "Today" and "tomorrow" in the PC's local time. */
export function dayRange(offsetDays: number, days = 1): { from: Date; to: Date } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() + offsetDays);
  const to = new Date(from);
  to.setDate(to.getDate() + days);
  return { from, to };
}

export const eventLine = (e: CalEvent) =>
  `${e.allDay ? "all day" : `${e.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}–${e.end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}: ${e.title}${e.location ? ` (${e.location})` : ""}`;
