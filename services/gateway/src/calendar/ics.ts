/**
 * A small iCalendar (RFC 5545) reader for the private "secret iCal address" calendars offer (Google, Outlook, Apple):
 * events, all-day events, time zones, common repeat rules (daily/weekly/monthly/yearly with interval, count, until,
 * weekdays, month days), excluded dates, moved/cancelled single occurrences. Read-only.
 */
export interface CalEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
}

interface Wall {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}
interface Stamp {
  wall: Wall;
  tz: string | null; // IANA zone, "UTC", or null for floating/local
  date: boolean; // all-day (VALUE=DATE)
}
interface RawEvent {
  uid: string;
  title: string;
  location?: string;
  start: Stamp;
  end?: Stamp;
  durationMs?: number;
  rrule?: Record<string, string>;
  exdates: number[];
  recurrenceId?: number;
  cancelled: boolean;
}

// Outlook/Exchange calendars use Windows zone names; map the common ones to IANA.
const WINDOWS_TZ: Record<string, string> = {
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  UTC: "UTC",
};

function validZone(tz: string): string | null {
  const z = WINDOWS_TZ[tz] ?? tz.replace(/^\/[^/]+\/[^/]+\//, ""); // some exporters prefix zones with "/mozilla.org/…/"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return null;
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Offset of `tz` from UTC at instant `ms`, in ms. */
function tzOffset(ms: number, tz: string): number {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(ms / 1000) * 1000;
}

/** The instant a wall-clock time in a zone corresponds to (DST-correct). */
function toInstant(w: Wall, tz: string | null): number {
  if (tz === "UTC") return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  if (!tz) return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime(); // floating: the PC's local time
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  const first = guess - tzOffset(guess, tz);
  const second = guess - tzOffset(first, tz);
  return second;
}

function parseStamp(value: string, params: Record<string, string>): Stamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const wall = { y: +m[1]!, m: +m[2]!, d: +m[3]!, h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  const date = !m[4] || params.VALUE === "DATE";
  const tz = m[7] ? "UTC" : params.TZID ? validZone(params.TZID) : null;
  return { wall, tz: date ? null : tz, date };
}

function parseDuration(v: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return undefined;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

const unescape = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

export function parseIcs(text: string): RawEvent[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: RawEvent[] = [];
  let cur: Partial<RawEvent> & { exdates: number[] } | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { exdates: [], cancelled: false };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.start) events.push({ uid: cur.uid ?? `noid-${events.length}`, title: cur.title || "(no title)", ...cur } as RawEvent);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...paramParts] = line.slice(0, colon).split(";");
    const value = line.slice(colon + 1);
    const params = Object.fromEntries(paramParts.map((p) => p.split("=") as [string, string]).map(([k, v]) => [k.toUpperCase(), (v ?? "").replace(/^"|"$/g, "")]));
    switch (name!.toUpperCase()) {
      case "UID":
        cur.uid = value.trim();
        break;
      case "SUMMARY":
        cur.title = unescape(value).slice(0, 200);
        break;
      case "LOCATION":
        cur.location = unescape(value).slice(0, 200) || undefined;
        break;
      case "DTSTART":
        cur.start = parseStamp(value, params) ?? undefined;
        break;
      case "DTEND":
        cur.end = parseStamp(value, params) ?? undefined;
        break;
      case "DURATION":
        cur.durationMs = parseDuration(value);
        break;
      case "RRULE":
        cur.rrule = Object.fromEntries(value.split(";").map((kv) => kv.split("=") as [string, string]).map(([k, v]) => [k.toUpperCase(), v ?? ""]));
        break;
      case "EXDATE":
        for (const v of value.split(",")) {
          const s = parseStamp(v, params);
          if (s) cur.exdates.push(s.date ? Date.UTC(s.wall.y, s.wall.m - 1, s.wall.d) : toInstant(s.wall, s.tz));
        }
        break;
      case "RECURRENCE-ID": {
        const s = parseStamp(value, params);
        if (s) cur.recurrenceId = s.date ? Date.UTC(s.wall.y, s.wall.m - 1, s.wall.d) : toInstant(s.wall, s.tz);
        break;
      }
      case "STATUS":
        cur.cancelled = value.trim().toUpperCase() === "CANCELLED";
        break;
    }
  }
  return events;
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const addDays = (w: Wall, n: number): Wall => {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return { ...w, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const weekday = (w: Wall) => new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Wall-clock start times of each occurrence, in order (bounded). */
function* occurrences(e: RawEvent, until: number): Generator<Wall> {
  const s = e.start.wall;
  const r = e.rrule;
  if (!r) {
    yield s;
    return;
  }
  const interval = Math.max(1, Number(r.INTERVAL ?? 1));
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const untilStamp = r.UNTIL ? parseStamp(r.UNTIL, {}) : null;
  const untilMs = untilStamp ? (untilStamp.date ? Date.UTC(untilStamp.wall.y, untilStamp.wall.m - 1, untilStamp.wall.d, 23, 59, 59) : toInstant(untilStamp.wall, untilStamp.tz ?? e.start.tz)) : Infinity;
  const startMs = toInstant(s, e.start.tz);
  const byDay = r.BYDAY ? r.BYDAY.split(",").map((d) => d.trim().toUpperCase()) : null;
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null;
  let n = 0;
  const emit = function* (w: Wall): Generator<Wall, boolean> {
    const ms = toInstant(w, e.start.tz);
    if (ms < startMs) return true;
    if (ms > untilMs || ms > until || n >= count) return false;
    n++;
    yield w;
    return true;
  };
  for (let i = 0; i < 5000; i++) {
    let batch: Wall[] = [];
    if (r.FREQ === "DAILY") batch = [addDays(s, i * interval)];
    else if (r.FREQ === "WEEKLY") {
      const weekStart = addDays(s, i * 7 * interval - weekday(s)); // Sunday of that week
      batch = (byDay ?? [DAYS[weekday(s)]!]).map((d) => DAYS.indexOf(d.slice(-2))).filter((x) => x >= 0).sort().map((x) => addDays(weekStart, x));
    } else if (r.FREQ === "MONTHLY") {
      const total = s.m - 1 + i * interval;
      const y = s.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (byDay?.length && /^-?\d/.test(byDay[0]!)) {
        // e.g. 2MO = second Monday, -1FR = last Friday
        for (const spec of byDay) {
          const k = parseInt(spec, 10);
          const day = DAYS.indexOf(spec.slice(-2));
          const dates = Array.from({ length: daysInMonth(y, m) }, (_, j) => j + 1).filter((d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay() === day);
          const d = k > 0 ? dates[k - 1] : dates[dates.length + k];
          if (d) batch.push({ ...s, y, m, d });
        }
        batch.sort((a, b) => a.d - b.d);
      } else {
        for (const md of byMonthDay ?? [s.d]) {
          const d = md > 0 ? md : daysInMonth(y, m) + md + 1;
          if (d >= 1 && d <= daysInMonth(y, m)) batch.push({ ...s, y, m, d });
        }
      }
    } else if (r.FREQ === "YEARLY") {
      const y = s.y + i * interval;
      if (s.d <= daysInMonth(y, s.m)) batch = [{ ...s, y }];
    } else {
      yield s; // unsupported rule: just the first occurrence
      return;
    }
    for (const w of batch) {
      const go = yield* emit(w);
      if (!go) return;
    }
  }
}

/** Events overlapping [from, to), expanded, sorted by start. */
export function eventsBetween(raw: RawEvent[], from: Date, to: Date): CalEvent[] {
  const overrides = new Map<string, Set<number>>();
  for (const e of raw) if (e.recurrenceId !== undefined) (overrides.get(e.uid) ?? overrides.set(e.uid, new Set()).get(e.uid)!).add(e.recurrenceId);
  const out: CalEvent[] = [];
  for (const e of raw) {
    const len =
      e.durationMs ??
      (e.end ? (e.start.date ? Date.UTC(e.end.wall.y, e.end.wall.m - 1, e.end.wall.d) - Date.UTC(e.start.wall.y, e.start.wall.m - 1, e.start.wall.d) : toInstant(e.end.wall, e.end.tz) - toInstant(e.start.wall, e.start.tz)) : e.start.date ? 86_400_000 : 0);
    for (const w of occurrences(e, to.getTime())) {
      const start = e.start.date ? new Date(w.y, w.m - 1, w.d) : new Date(toInstant(w, e.start.tz));
      const key = e.start.date ? Date.UTC(w.y, w.m - 1, w.d) : start.getTime();
      if (e.recurrenceId === undefined && (e.exdates.includes(key) || overrides.get(e.uid)?.has(key))) continue;
      const end = new Date(start.getTime() + Math.max(0, len));
      if (e.cancelled) continue;
      if (end.getTime() <= from.getTime() && !(len === 0 && start.getTime() >= from.getTime())) continue;
      if (start.getTime() >= to.getTime()) continue;
      out.push({ title: e.title, start, end, allDay: e.start.date, location: e.location });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
