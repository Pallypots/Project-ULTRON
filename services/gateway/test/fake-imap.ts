import { createServer, type Server, type Socket } from "node:net";

export interface FakeMail {
  uid: number;
  fromName: string;
  fromAddress: string;
  subject: string;
  body: string;
  seen: boolean;
}

/** A tiny IMAP server: enough of the protocol for ULTRON's read-only email (login, examine, search, fetch). */
export async function startFakeImap(user: string, pass: string, mails: FakeMail[]) {
  const commands: string[] = [];
  const q = (s: string) => `"${s.replace(/(["\\])/g, "\\$1")}"`;
  const env = (m: FakeMail) => {
    const [box, host] = m.fromAddress.split("@");
    const addr = `((${q(m.fromName)} NIL ${q(box!)} ${q(host!)}))`;
    return `(${q("Sun, 01 Nov 2026 10:00:00 +0000")} ${q(m.subject)} ${addr} ${addr} ${addr} ((NIL NIL "me" "example.com")) NIL NIL NIL ${q(`<${m.uid}@fake>`)})`;
  };
  const uidsIn = (set: string) => {
    const out = new Set<number>();
    for (const part of set.split(",")) {
      const [a, b] = part.split(":");
      const lo = Number(a);
      const hi = b === "*" ? Infinity : b ? Number(b) : lo;
      for (const m of mails) if (m.uid >= Math.min(lo, hi) && m.uid <= Math.max(lo, hi)) out.add(m.uid);
    }
    return mails.filter((m) => out.has(m.uid));
  };
  const handle = (sock: Socket, line: string) => {
    commands.push(line.replace(pass, "***"));
    const [tag, ...rest] = line.split(" ");
    const cmd = rest.join(" ");
    const up = cmd.toUpperCase();
    const ok = (extra = "") => sock.write(`${extra}${tag} OK done\r\n`);
    if (up.startsWith("CAPABILITY")) return ok("* CAPABILITY IMAP4rev1\r\n");
    if (up.startsWith("LOGIN")) {
      const m = /^LOGIN\s+"?([^"\s]+)"?\s+"?([^"\s]+)"?/i.exec(cmd);
      return m && m[1] === user && m[2] === pass ? ok() : sock.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
    }
    if (up.startsWith("EXAMINE") || up.startsWith("SELECT"))
      return sock.write(`* FLAGS (\\Seen)\r\n* ${mails.length} EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n* OK [UIDNEXT ${Math.max(0, ...mails.map((m) => m.uid)) + 1}] ok\r\n${tag} OK [READ-ONLY] done\r\n`);
    if (up.startsWith("LIST")) return ok('* LIST (\\HasNoChildren) "/" INBOX\r\n');
    if (up.startsWith("UID SEARCH")) {
      let hits = mails;
      if (/\bUNSEEN\b/.test(up)) hits = hits.filter((m) => !m.seen);
      const from = /FROM\s+"?([^"\s]+)"?/i.exec(cmd);
      if (from) hits = hits.filter((m) => m.fromAddress.includes(from[1]!) || m.fromName.toLowerCase().includes(from[1]!.toLowerCase()));
      return ok(`* SEARCH ${hits.map((m) => m.uid).join(" ")}\r\n`.replace("SEARCH \r", "SEARCH\r"));
    }
    if (up.startsWith("UID FETCH")) {
      const set = cmd.split(" ")[2]!;
      let out = "";
      for (const m of uidsIn(set)) {
        const seq = mails.indexOf(m) + 1;
        const items = [`UID ${m.uid}`];
        if (/FLAGS/.test(up)) items.push(`FLAGS (${m.seen ? "\\Seen" : ""})`);
        if (/INTERNALDATE/.test(up)) items.push(`INTERNALDATE "01-Nov-2026 10:00:00 +0000"`);
        if (/ENVELOPE/.test(up)) items.push(`ENVELOPE ${env(m)}`);
        if (/BODYSTRUCTURE/.test(up)) items.push(`BODYSTRUCTURE ("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" ${Buffer.byteLength(m.body)} 1 NIL NIL NIL NIL)`);
        const mime = /BODY\.PEEK\[1\.MIME\]/.test(up);
        if (mime) {
          const h = "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n";
          items.push(`BODY[1.MIME] {${Buffer.byteLength(h)}}\r\n${h}`);
        }
        if (/BODY\.PEEK\[HEADER\]/.test(up)) {
          const h = `From: ${m.fromName} <${m.fromAddress}>\r\nSubject: ${m.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`;
          items.push(`BODY[HEADER] {${Buffer.byteLength(h)}}\r\n${h}`);
        }
        if (/BODY\.PEEK\[TEXT\]/.test(up)) items.push(`BODY[TEXT]<0> {${Buffer.byteLength(m.body)}}\r\n${m.body}`);
        if (/RFC822\.SIZE/.test(up)) items.push(`RFC822.SIZE ${Buffer.byteLength(m.body) + 100}`);
        if (/BODY\.PEEK\[1\](?!\.)/.test(up) || /BODY\.PEEK\[1\]</.test(up)) items.push(`BODY[1] {${Buffer.byteLength(m.body)}}\r\n${m.body}`);
        out += `* ${seq} FETCH (${items.join(" ")})\r\n`;
      }
      return ok(out);
    }
    if (up.startsWith("LOGOUT")) {
      sock.write(`* BYE bye\r\n${tag} OK done\r\n`);
      return sock.end();
    }
    return ok(); // NOOP, ID, ENABLE, NAMESPACE, CLOSE, ...
  };
  const sockets = new Set<Socket>();
  const server: Server = createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.write("* OK [CAPABILITY IMAP4rev1] fake ready\r\n");
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (line.trim()) handle(sock, line);
      }
    });
    sock.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as { port: number }).port, commands, close: () => new Promise<void>((r) => { sockets.forEach((s) => s.destroy()); server.close(() => r()); }) };
}
