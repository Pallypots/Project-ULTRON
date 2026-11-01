import { useEffect, useState } from "react";
import { api, onThisPc, type EmailStatus } from "../api.ts";

/** Connections → Email: read-only inbox access with an app password (entered here, never in chat). */
export function EmailPanel({ onAsk }: { onAsk: (q: string) => void }) {
  const [s, setS] = useState<EmailStatus | null>(null);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api.email().then((r) => setS(r.email)).catch(() => {});
  }, []);
  if (!s) return null;
  const needsHost = address.includes("@") && !/@(gmail|googlemail|icloud|me|mac|aol|fastmail|outlook|hotmail|live|msn)\.|@yahoo\.|@gmx\./i.test(address);
  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.connectEmail(address.trim(), password, host.trim() || undefined);
      setS(r.email);
      setPassword("");
      setMsg({ ok: true, text: `Connected (read-only). ${r.unread} unread. Try "any new emails?"` });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel form" aria-labelledby="email-title">
      <h2 className="panel__title" id="email-title">Email {s.connected ? "· connected (read-only)" : ""}</h2>
      {s.connected ? (
        <>
          <p className="muted small">
            ULTRON can check and read {s.address}'s inbox when you ask ("any new emails?", "read the one from Mum"). It never sends, deletes or marks
            anything as read, and treats what's in emails as untrusted.
          </p>
          {s.error && <div className="banner banner--warn" role="status">Last check failed: {s.error}</div>}
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => onAsk("any new emails?")}>Any new emails?</button>
            {onThisPc() && (
              <button type="button" className="btn btn--danger" onClick={async () => { setS((await api.disconnectEmail()).email); setMsg({ ok: true, text: "Email disconnected and its app password deleted." }); }}>
                Disconnect
              </button>
            )}
          </div>
        </>
      ) : onThisPc() ? (
        <form onSubmit={connect} className="form">
          <p className="muted small">Read-only access to your inbox with an <strong>app password</strong> (a separate password just for ULTRON that you can cancel any time). Enter it here, never in chat.</p>
          <ul className="small steps">
            <li><strong>Gmail</strong>: turn on 2-Step Verification, then go to <strong>myaccount.google.com/apppasswords</strong>, create one called "ULTRON" and copy the 16 letters.</li>
            <li><strong>iCloud</strong>: appleid.apple.com → Sign-In and Security → App-Specific Passwords.</li>
            <li><strong>Yahoo</strong>: Account Security → Generate app password.</li>
            <li><strong>Outlook / Hotmail</strong>: Microsoft no longer allows this; not supported yet.</li>
          </ul>
          <label className="field">
            <span>Email address</span>
            <input type="email" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="field">
            <span>App password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </label>
          {needsHost && (
            <label className="field">
              <span>IMAP server (from your provider's help pages)</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" autoComplete="off" spellCheck={false} />
            </label>
          )}
          <button className="btn btn--primary" type="submit" disabled={busy || !address.includes("@") || password.length < 8}>{busy ? "Checking…" : "Connect email (read-only)"}</button>
        </form>
      ) : (
        <p className="muted small">Connect email on the PC (Connections → Email).</p>
      )}
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
    </section>
  );
}
