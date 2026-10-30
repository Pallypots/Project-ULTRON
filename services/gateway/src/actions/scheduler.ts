import type { Stores } from "@ultron/memory";
import type { EventBus } from "./events.ts";

const MISSED_GRACE_MS = 2 * 60_000;
const MAX_SLEEP_MS = 30_000;

/**
 * Fires reminders on time while ULTRON is running. Reminders that came due while it was off are marked
 * "missed" at startup and shown to the owner, never silently dropped (blueprint §6.5).
 */
export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private stores: Stores,
    private bus: EventBus,
    private now: () => Date = () => new Date(),
  ) {}

  start() {
    const missed = this.stores.reminders.markMissed(MISSED_GRACE_MS, this.now());
    if (missed.length) {
      this.stores.audit.record("reminders.missed_while_offline", "system", null, { count: missed.length });
      this.bus.emit({ type: "reminders_missed", reminders: missed });
    }
    this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Call after creating/cancelling so a sooner reminder isn't waiting on a long sleep. */
  reschedule() {
    if (this.timer) clearTimeout(this.timer);
    this.tick();
  }

  private tick = () => {
    if (this.stopped) return;
    const now = this.now();
    for (const r of this.stores.reminders.due(now)) {
      const fired = this.stores.reminders.setStatus(r.id, "fired")!;
      this.stores.audit.record("reminder.fired", "system", r.id, {});
      this.bus.emit({ type: "reminder_fired", reminder: fired });
    }
    const next = this.stores.reminders.upcoming()[0];
    // Wake for the next reminder, but at least every 30 s so clock changes and sleep/resume are handled.
    const wait = next ? Math.max(50, Math.min(MAX_SLEEP_MS, new Date(next.dueAt).getTime() - now.getTime())) : MAX_SLEEP_MS;
    this.timer = setTimeout(this.tick, wait);
    this.timer.unref?.();
  };
}
