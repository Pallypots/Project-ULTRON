// Deterministic parsing of reminder/timer commands, so they work reliably with any brain (even small local models).

export type TimeIntent =
  | { type: "reminder"; text: string; due: Date; label: string }
  | { type: "list_reminders" }
  | { type: "cancel_reminder"; query: string };

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty five": 45, "forty-five": 45, sixty: 60 };
const UNIT_MS: [RegExp, number][] = [
  [/^s(ec(ond)?s?)?$/, 1000],
  [/^m(in(ute)?s?)?$/, 60_000],
  [/^h((ou)?rs?)?$/, 3_600_000],
  [/^days?$/, 86_400_000],
];
const NUMWORD = String.raw`\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty[- ]five|sixty`;
const UNIT = String.raw`seconds?|secs?|minutes?|mins?|hours?|hrs?|days?`;
const DURATION = String.raw`(?:half an hour|(?:${NUMWORD})\s*(?:${UNIT})(?:\s*(?:and\s*)?(?:${NUMWORD})\s*(?:${UNIT}))?)`;
const CLOCK = String.raw`(?:(?:today|tonight|tomorrow)\s+)?(?:at\s+)?(?:noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)(?:\s+(?:today|tonight|tomorrow))?`;
const PREFIX = String.raw`^\s*(?:(?:hey|ok|okay)\s+)?(?:ultron[\s,:!.-]+)?(?:please\s+|can you\s+|could you\s+)?`;

export function parseDurationMs(text: string): number | null {
  const t = text.toLowerCase().trim();
  if (t === "half an hour") return 30 * 60_000;
  const re = new RegExp(String.raw`(${NUMWORD})\s*(${UNIT})`, "g");
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const n = NUM[m[1]!.replace("-", " ")] ?? Number(m[1]);
    const unit = UNIT_MS.find(([r]) => r.test(m![2]!))?.[1];
    if (!unit || !Number.isFinite(n)) return null;
    total += n * unit;
  }
  return total > 0 ? total : null;
}

/** Resolves a spoken clock time to the next matching moment after `now` (local time). */
export function parseClock(text: string, now: Date): Date | null {
  const t = text.toLowerCase().replace(/\./g, "").trim();
  const tomorrow = /\btomorrow\b/.test(t);
  const tonight = /\btonight\b/.test(t);
  let h: number;
  let min = 0;
  if (/\bnoon\b/.test(t)) h = 12;
  else if (/\bmidnight\b/.test(t)) h = 0;
  else {
    const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(t);
    if (!m) return null;
    h = Number(m[1]);
    min = Number(m[2] ?? 0);
    const ap = m[3];
    if (h > 23 || min > 59 || (ap && (h < 1 || h > 12))) return null;
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && (tonight || (h < 12 && h >= 1 && !tomorrow))) {
      // "at 5" with no am/pm: the next 5 o'clock that's still ahead today, else tonight's.
      const am = new Date(now);
      am.setHours(h, min, 0, 0);
      if (tonight || am <= now) h += 12;
    }
  }
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (tomorrow) d.setDate(d.getDate() + 1);
  else if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

const clean = (s: string) => s.trim().replace(/^(?:to|that|about)\s+/i, "").replace(/[.!?\s]+$/, "");
const fmt = (d: Date, now: Date) => {
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `at ${time}` : `tomorrow at ${time}`.replace(/^tomorrow/, d.getDate() === new Date(now.getTime() + 86_400_000).getDate() ? "tomorrow" : d.toLocaleDateString());
};
const fmtDuration = (ms: number) => {
  const parts: string[] = [];
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  if (h) parts.push(`${h} hour${h > 1 ? "s" : ""}`);
  if (m) parts.push(`${m} minute${m > 1 ? "s" : ""}`);
  if (s && !h) parts.push(`${s} second${s > 1 ? "s" : ""}`);
  return parts.join(" ");
};

export function detectTimeIntent(message: string, now = new Date()): TimeIntent | null {
  const msg = message.trim();
  let m: RegExpExecArray | null;

  if (new RegExp(PREFIX + String.raw`(?:what are|show|list|read)\s+(?:me\s+)?(?:my|all|the)\s+(?:upcoming\s+)?(?:reminders|timers)[?.!\s]*$`, "i").test(msg) ||
      new RegExp(PREFIX + String.raw`(?:do i have|are there) any (?:reminders|timers)[?.!\s]*$`, "i").test(msg))
    return { type: "list_reminders" };

  if ((m = new RegExp(PREFIX + String.raw`(?:cancel|delete|remove|stop)\s+(?:my\s+|the\s+)?(?:reminder|timer)(?:\s+(?:to|about|for)\s+(.+?))?[.!?\s]*$`, "i").exec(msg)))
    return { type: "cancel_reminder", query: (m[1] ?? "").trim() };

  // Timers: "set a timer for 5 minutes", "start a 10 minute timer", "timer 3 minutes"
  if ((m = new RegExp(PREFIX + String.raw`(?:set|start)?\s*(?:a|an)?\s*(?:timer\s+(?:for\s+)?(${DURATION})|(${DURATION})\s+timer)[.!?\s]*$`, "i").exec(msg))) {
    const span = (m[1] ?? m[2])!.replace(/(\d+)\s*-?\s*(minute|hour|second)/i, "$1 $2");
    const ms = parseDurationMs(span);
    if (ms) return { type: "reminder", text: `Your ${fmtDuration(ms).replace(/(\d+) (\w+?)s\b/g, "$1-$2")} timer is done`, due: new Date(now.getTime() + ms), label: `in ${fmtDuration(ms)}` };
  }

  // "remind me in 10 minutes to X" / "remind me to X in 10 minutes"
  if ((m = new RegExp(PREFIX + String.raw`remind me\s+in\s+(${DURATION})\s+(?:to|that|about)?\s*(.+)$`, "i").exec(msg)) ||
      (m = new RegExp(PREFIX + String.raw`remind me\s+(?:to|that|about)\s+(.+?)\s+in\s+(${DURATION})[.!?\s]*$`, "i").exec(msg))) {
    const durFirst = parseDurationMs(m[1]!) !== null;
    const ms = parseDurationMs(durFirst ? m[1]! : m[2]!);
    const text = clean(durFirst ? m[2]! : m[1]!);
    if (ms && text) return { type: "reminder", text, due: new Date(now.getTime() + ms), label: `in ${fmtDuration(ms)}` };
  }

  // "remind me at 5pm to X" / "remind me tomorrow at 9 to X" / "remind me to X at 5pm"
  if ((m = new RegExp(PREFIX + String.raw`remind me\s+(${CLOCK})\s+(?:to|that|about)\s+(.+)$`, "i").exec(msg)) ||
      (m = new RegExp(PREFIX + String.raw`remind me\s+(?:to|that|about)\s+(.+?)\s+((?:today\s+|tonight\s+|tomorrow\s+)?at\s+${CLOCK}|tomorrow|tonight)[.!?\s]*$`, "i").exec(msg))) {
    const clockFirst = /^(?:today|tonight|tomorrow|at|noon|midnight|\d)/i.test(m[1]!);
    const clock = clockFirst ? m[1]! : m[2]!;
    const text = clean(clockFirst ? m[2]! : m[1]!);
    const due = parseClock(/\d|noon|midnight/i.test(clock) ? clock : `${clock} 9am`, now);
    if (due && text) return { type: "reminder", text, due, label: fmt(due, now) };
  }
  return null;
}
