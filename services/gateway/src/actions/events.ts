import type { Reminder, ToolExecution } from "@ultron/memory";

export type ServerEvent =
  | { type: "reminder_fired"; reminder: Reminder }
  | { type: "reminders_missed"; reminders: Reminder[] }
  | { type: "action_updated"; execution: ToolExecution }
  | { type: "hello"; at: string };

/** Fan-out of live events to every connected ULTRON window (desktop now, phone later). */
export class EventBus {
  private listeners = new Set<(e: ServerEvent) => void>();
  /** Events emitted while no window was open are kept briefly and replayed to the next window. */
  private backlog: ServerEvent[] = [];

  subscribe(fn: (e: ServerEvent) => void): () => void {
    this.listeners.add(fn);
    for (const e of this.backlog.splice(0)) fn(e);
    return () => this.listeners.delete(fn);
  }

  emit(e: ServerEvent) {
    if (!this.listeners.size && e.type !== "hello") {
      this.backlog.push(e);
      if (this.backlog.length > 50) this.backlog.shift();
    }
    for (const fn of this.listeners) fn(e);
  }

  get connections() {
    return this.listeners.size;
  }
}
