import { ImapFlow, type MessageStructureObject } from "imapflow";
import type { Stores } from "@ultron/memory";
import type { SecretStore } from "../secrets.ts";

/**
 * Read-only email over IMAP with an app password (Gmail, iCloud, Yahoo, Fastmail…). ULTRON reads headers and, when
 * asked, one message's text. It never sends, deletes or marks anything (the mailbox is opened read-only, bodies are
 * fetched with PEEK). Everything in an email is untrusted data.
 */
export const MAIL_SECRET = "EMAIL_APP_PASSWORD";
export const MAIL_PREF = "email_account";

export interface MailAccount {
  address: string;
  host: string;
  port: number;
}

export interface MailSummary {
  id: number;
  from: string;
  fromAddress: string;
  subject: string;
  date: string;
  unread: boolean;
}

export class MailError extends Error {}

const PRESETS: [RegExp, string][] = [
  [/@(gmail|googlemail)\.com$/i, "imap.gmail.com"],
  [/@(icloud|me|mac)\.com$/i, "imap.mail.me.com"],
  [/@yahoo\./i, "imap.mail.yahoo.com"],
  [/@(aol)\.com$/i, "imap.aol.com"],
  [/@(fastmail\.com|fastmail\.fm)$/i, "imap.fastmail.com"],
  [/@gmx\./i, "imap.gmx.com"],
  [/@(outlook|hotmail|live|msn)\./i, "outlook.office365.com"],
];

export function imapHostFor(address: string): string | null {
  return PRESETS.find(([re]) => re.test(address.trim()))?.[1] ?? null;
}

function explain(err: unknown, host: string): MailError {
  const e = err as { authenticationFailed?: boolean; code?: string; message?: string; responseText?: string };
  if (e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i.test(`${e.responseText} ${e.message}`)) {
    if (/office365|outlook/.test(host)) return new MailError("Outlook.com no longer allows app passwords for this kind of access, so ULTRON can't read it yet. Gmail, iCloud, Yahoo and Fastmail work.");
    return new MailError("The email server refused the login. Use an app password (not your normal password); see the steps above.");
  }
  if (e.code === "ENOTFOUND" || e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT" || /timeout/i.test(e.message ?? "")) return new MailError(`Couldn't reach ${host}. Check the server name and your internet connection.`);
  return new MailError(`The email server said: ${(e.responseText ?? e.message ?? "unknown problem").slice(0, 160)}`);
}

const clean = (s: string | undefined) => (s ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

export class MailService {
  private cache: { at: number; key: string; list: MailSummary[] } | null = null;
  lastError: string | null = null;

  constructor(
    private stores: Stores,
    private secrets: SecretStore,
  ) {}

  account(): MailAccount | null {
    const a = this.stores.preferences.get<MailAccount | null>(MAIL_PREF, null);
    return a?.address ? a : null;
  }
  get connected() {
    return Boolean(this.account() && this.secrets.has(MAIL_SECRET));
  }
  status() {
    const a = this.account();
    return { connected: this.connected, address: a?.address ?? null, host: a?.host ?? null, error: this.lastError };
  }

  private client(a: MailAccount, pass: string) {
    const insecure = process.env.ULTRON_IMAP_INSECURE === "1" && a.host === "127.0.0.1"; // local test server only
    return new ImapFlow({ host: a.host, port: a.port, secure: !insecure, doSTARTTLS: insecure ? false : undefined, auth: { user: a.address, pass }, logger: false, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000, disableAutoIdle: true });
  }

  private async session<T>(a: MailAccount, pass: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = this.client(a, pass);
    c.on("error", () => {}); // reported through the awaited calls instead
    try {
      await c.connect();
    } catch (err) {
      c.close(); // a failed login must not leave the connection open
      throw explain(err, a.host);
    }
    try {
      await c.mailboxOpen("INBOX", { readOnly: true });
      return await fn(c);
    } catch (err) {
      throw err instanceof MailError ? err : explain(err, a.host);
    } finally {
      await c.logout().catch(() => c.close());
    }
  }

  /** Checks the login works (and the inbox opens) before saving. */
  async connect(address: string, password: string, host?: string): Promise<{ unread: number }> {
    const addr = address.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) throw new MailError("That doesn't look like an email address.");
    const h = (host?.trim() || imapHostFor(addr) || "").toLowerCase();
    if (!h) throw new MailError("I don't know that provider's mail server. Enter its IMAP server name (e.g. imap.example.com).");
    if (!/^[a-z0-9.-]+$/.test(h)) throw new MailError("That server name doesn't look right.");
    const port = Number(process.env.ULTRON_IMAP_PORT ?? 993);
    const a: MailAccount = { address: addr, host: h, port };
    const pass = password.replace(/\s+/g, ""); // Gmail shows app passwords in groups of four
    const unread = await this.session(a, pass, async (c) => { const r = await c.search({ seen: false }, { uid: true }); return r ? r.length : 0; });
    this.stores.preferences.set(MAIL_PREF, a);
    this.secrets.set(MAIL_SECRET, pass);
    this.cache = null;
    this.lastError = null;
    return { unread };
  }

  disconnect() {
    this.secrets.set(MAIL_SECRET, null);
    this.stores.preferences.set(MAIL_PREF, null);
    this.cache = null;
  }

  private creds(): [MailAccount, string] {
    const a = this.account();
    const p = this.secrets.get(MAIL_SECRET);
    if (!a || !p) throw new MailError("Email isn't connected. Add it in Connections → Email.");
    return [a, p];
  }

  /** Recent messages, newest first (headers only). */
  async recent(opts: { unreadOnly?: boolean; days?: number; limit?: number; from?: string } = {}): Promise<MailSummary[]> {
    const [a, p] = this.creds();
    const days = Math.min(30, Math.max(1, opts.days ?? 3));
    const limit = Math.min(25, Math.max(1, opts.limit ?? 10));
    const key = JSON.stringify([opts.unreadOnly, days, limit, opts.from]);
    if (this.cache && this.cache.key === key && Date.now() - this.cache.at < 60_000) return this.cache.list;
    try {
      const list = await this.session(a, p, async (c) => {
        const since = new Date(Date.now() - days * 86_400_000);
        const q: Record<string, unknown> = { since };
        if (opts.unreadOnly) q.seen = false;
        if (opts.from) q.from = opts.from;
        const uids = ((await c.search(q, { uid: true })) || []).sort((x, y) => y - x).slice(0, limit);
        if (!uids.length) return [];
        const out: MailSummary[] = [];
        for await (const m of c.fetch(uids.join(","), { uid: true, flags: true, envelope: true, internalDate: true }, { uid: true })) {
          const f = m.envelope?.from?.[0];
          out.push({ id: m.uid, from: clean(f?.name) || f?.address || "unknown", fromAddress: f?.address ?? "", subject: clean(m.envelope?.subject) || "(no subject)", date: new Date(m.internalDate ?? m.envelope?.date ?? Date.now()).toISOString(), unread: !m.flags?.has("\\Seen") });
        }
        return out.sort((x, y) => y.date.localeCompare(x.date));
      });
      this.cache = { at: Date.now(), key, list };
      this.lastError = null;
      return list;
    } catch (err) {
      this.lastError = (err as Error).message;
      throw err;
    }
  }

  /** One message's text (plain text preferred; HTML reduced to text), without marking it read. */
  async read(id: number): Promise<{ from: string; subject: string; date: string; text: string }> {
    const [a, p] = this.creds();
    return this.session(a, p, async (c) => {
      const m = await c.fetchOne(String(id), { uid: true, envelope: true, internalDate: true, bodyStructure: true }, { uid: true });
      if (!m) throw new MailError("That email isn't in the inbox any more.");
      const parts: MessageStructureObject[] = [];
      const walk = (n?: MessageStructureObject) => {
        if (!n) return;
        if (n.childNodes?.length) n.childNodes.forEach(walk);
        else parts.push(n);
      };
      walk(m.bodyStructure);
      const pick = parts.find((x) => x.type === "text/plain" && x.disposition !== "attachment") ?? parts.find((x) => x.type === "text/html" && x.disposition !== "attachment");
      let text = "";
      if (pick) {
        const dl = await c.download(String(id), pick.part ?? "1", { uid: true, maxBytes: 200_000 });
        const chunks: Buffer[] = [];
        for await (const ch of dl.content) chunks.push(Buffer.from(ch));
        text = Buffer.concat(chunks).toString("utf8");
        if (pick.type === "text/html") text = htmlToText(text);
      }
      const f = m.envelope?.from?.[0];
      return { from: clean(f?.name) || f?.address || "unknown", subject: clean(m.envelope?.subject) || "(no subject)", date: new Date(m.internalDate ?? Date.now()).toISOString(), text: text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000) };
    });
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n");
}
