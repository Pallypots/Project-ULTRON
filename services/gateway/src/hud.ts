import { statfs } from "node:fs/promises";
import { cpus, freemem, totalmem, uptime } from "node:os";
import type { Stores } from "@ultron/memory";
import { usesFahrenheit, weatherFor } from "./actions/knowledge.ts";
import type { CalendarService } from "./calendar/service.ts";
import { dayRange } from "./calendar/service.ts";

/**
 * Everything the command-centre Home screen shows, in one cheap call it can poll every few seconds. Nothing here waits
 * on the network: weather and the calendar are refreshed in the background and the last good copy is returned.
 */
export class HudService {
  private lastCpu = cpus().map((c) => c.times);
  private cpuPct = 0;
  private weather: { at: number; place: string; data: Awaited<ReturnType<typeof weatherFor>> | null; busy: boolean } = { at: 0, place: "", data: null, busy: false };
  private agenda: { at: number; events: { title: string; start: string; end: string; allDay: boolean; location?: string }[]; busy: boolean } = { at: 0, events: [], busy: false };
  private readonly startedAt = Date.now();

  constructor(
    private stores: Stores,
    private dataDir: string,
    private calendar?: CalendarService,
  ) {}

  private sampleCpu(): number {
    const now = cpus().map((c) => c.times);
    let idle = 0;
    let total = 0;
    now.forEach((t, i) => {
      const p = this.lastCpu[i] ?? t;
      const d = (k: keyof typeof t) => t[k] - p[k];
      idle += d("idle");
      total += d("user") + d("nice") + d("sys") + d("idle") + d("irq");
    });
    this.lastCpu = now;
    if (total > 0) this.cpuPct = Math.round((1 - idle / total) * 100);
    return this.cpuPct;
  }

  async system() {
    const disk = await statfs(this.dataDir).catch(() => null);
    return {
      cpu: this.sampleCpu(),
      cpuThreads: cpus().length,
      cpuModel: cpus()[0]?.model.replace(/\s+/g, " ").trim() ?? "",
      ram: { used: totalmem() - freemem(), total: totalmem() },
      disk: disk ? { used: (disk.blocks - disk.bavail) * disk.bsize, total: disk.blocks * disk.bsize } : null,
      pcUptimeSec: Math.round(uptime()),
      ultronUptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  private refreshWeather() {
    const place = this.stores.preferences.get<string>("home_location", "").trim();
    const w = this.weather;
    if (!place) {
      w.data = null;
      w.place = "";
      return;
    }
    if (w.busy || (place === w.place && Date.now() - w.at < 20 * 60_000)) return;
    w.busy = true;
    weatherFor(place, usesFahrenheit(place))
      .then((data) => Object.assign(w, { data, place, at: Date.now() }))
      .catch(() => Object.assign(w, { place, at: Date.now() - 15 * 60_000 })) // try again in ~5 minutes
      .finally(() => (w.busy = false));
  }

  private refreshAgenda() {
    const a = this.agenda;
    if (!this.calendar?.connected) {
      a.events = [];
      return;
    }
    if (a.busy || Date.now() - a.at < 5 * 60_000) return;
    a.busy = true;
    const { from } = dayRange(0);
    const { to } = dayRange(1);
    this.calendar
      .events(from, to)
      .then((evs) => Object.assign(a, { at: Date.now(), events: evs.slice(0, 8).map((e) => ({ title: e.title, start: e.start.toISOString(), end: e.end.toISOString(), allDay: e.allDay, location: e.location })) }))
      .catch(() => (a.at = Date.now() - 4 * 60_000))
      .finally(() => (a.busy = false));
  }

  async summary() {
    this.refreshWeather();
    this.refreshAgenda();
    const s = this.stores;
    const reminders = s.reminders.upcoming().slice(0, 5).map((r) => ({ id: r.id, text: r.text, dueAt: r.dueAt }));
    const todos = s.todos.list();
    const pending = s.actions.pending().map((a) => ({ id: a.id, tool: a.tool, summary: a.summary }));
    const feed = s.connectors.events({ unreadOnly: true, limit: 5 }).map((e) => ({ id: e.id, title: e.title, source: e.source, url: e.canonicalUrl }));
    const w = this.weather.data && "now" in this.weather.data ? this.weather.data : null;
    return {
      system: await this.system(),
      weather: w ? { place: w.place, now: w.now, nextDays: w.next_days } : null,
      homeLocationSet: Boolean(this.weather.place),
      agenda: this.agenda.events,
      calendarConnected: Boolean(this.calendar?.connected),
      reminders,
      todos: { open: todos.length, top: todos.slice(0, 5).map((t) => ({ id: t.id, text: t.text })) },
      pendingApprovals: pending,
      watchers: s.watchers.active().length,
      feed,
      memories: s.memories.list().length,
    };
  }
}
