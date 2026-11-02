import { createHash } from "node:crypto";
import type { Stores, Watcher } from "@ultron/memory";
import type { EventBus } from "./actions/events.ts";
import { fetchPage } from "./actions/knowledge.ts";

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
/** Page text without things that change on every load (times, counters), so "changed" means the content changed. */
export const normalise = (text: string) => text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "").replace(/\s+/g, " ").trim();

/**
 * Keeps an eye on web pages for the owner: tells them when a page changes, or when it starts saying something
 * ("in stock", "tickets available"). Checks only while ULTRON is running, with the same safe page reader as read_webpage.
 */
export class WatcherService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private stores: Stores,
    private bus: EventBus,
    private now: () => number = () => Date.now(),
  ) {}

  start() {
    if (process.env.ULTRON_WATCHERS === "off") return; // automated tests call tick() directly
    this.timer ??= setInterval(() => void this.tick().catch(() => {}), 60_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Checks every watcher that's due. Returns how many reported something. */
  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let hits = 0;
    try {
      for (const w of this.stores.watchers.active()) {
        const due = !w.lastCheckedAt || this.now() - Date.parse(w.lastCheckedAt) >= w.everyMinutes * 60_000;
        if (due && (await this.check(w))) hits++;
      }
    } finally {
      this.busy = false;
    }
    return hits;
  }

  /** One check: the first check only records the page; later checks report changes (or the wanted text appearing). */
  async check(w: Watcher): Promise<boolean> {
    let text: string;
    try {
      text = normalise((await fetchPage(w.url)).text);
    } catch (err) {
      this.stores.watchers.checked(w.id, { error: (err as Error).message });
      return false;
    }
    const h = hash(text);
    const first = w.lastHash === null;
    const changed = !first && h !== w.lastHash;
    this.stores.watchers.checked(w.id, { hash: h, changed, error: null });
    if (w.lookFor) {
      const found = text.toLowerCase().includes(w.lookFor.toLowerCase());
      // Report when the wanted text appears, not on every check while it's there.
      if (!found || (!first && !changed)) return false;
      this.notify(w, `"${w.lookFor}" is now on ${w.label}.`);
      this.stores.watchers.stop(w.id); // done: it said what the owner was waiting for
      return true;
    }
    if (!changed) return false;
    this.notify(w, `${w.label} has changed.`);
    return true;
  }

  private notify(w: Watcher, body: string) {
    this.stores.audit.record("watcher.triggered", "system", w.id, { url: w.url });
    this.bus.emit({ type: "checkin", kind: "watch", title: "Something changed", body: `${body} ${w.url}` });
  }
}
