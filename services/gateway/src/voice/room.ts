/**
 * Room awareness (opt-in): while hands-free is on, speech NOT addressed to ULTRON is normally dropped. With this on, the
 * last few minutes are kept in memory only (never written to disk, logs or the database) so "Ultron, what do you think?"
 * can follow the conversation it just heard. Used only with a local brain, so it never leaves the PC.
 */
export const ROOM_MAX_AGE_MS = 3 * 60_000;
const MAX_AGE_MS = ROOM_MAX_AGE_MS;
const MAX_LINES = 40;

export class RoomContext {
  private lines: { at: number; text: string }[] = [];
  enabled = false;
  /** Goes up every time everything is forgotten, so copies kept elsewhere (a message's sent context) know to go too. */
  epoch = 0;

  constructor(private now: () => number = () => Date.now()) {}

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.clear();
  }

  add(text: string) {
    if (!this.enabled) return;
    const t = text.trim();
    if (!t) return;
    this.lines.push({ at: this.now(), text: t.slice(0, 500) });
    this.prune();
  }

  /** What was said recently, oldest first (expired lines are forgotten). */
  recent(): string[] {
    this.prune();
    return this.lines.map((l) => l.text);
  }

  clear() {
    this.lines = [];
    this.epoch++;
  }

  private prune() {
    const cutoff = this.now() - MAX_AGE_MS;
    this.lines = this.lines.filter((l) => l.at >= cutoff).slice(-MAX_LINES);
  }
}
