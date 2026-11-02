import { useEffect, useState } from "react";
import { Icon, type IconName } from "../icons.tsx";
import { api, onThisPc } from "../api.ts";

type Remote = Awaited<ReturnType<typeof api.remote>>;

/** Settings → Phone access: Tailscale address, pairing codes, and paired devices (PC only). */
export function PhoneAccess() {
  const [r, setR] = useState<Remote | null>(null);
  const [host, setHost] = useState("");
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [left, setLeft] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    api.remote().then((x) => {
      setR(x);
      setHost((h) => h || x.settings.host || x.detectedHost || "");
    });
  useEffect(() => {
    if (onThisPc()) load().catch(() => {});
  }, []);
  useEffect(() => {
    if (!pair) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((new Date(pair.expiresAt).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (!s) {
        setPair(null);
        load().catch(() => {});
      }
    }, 1000);
    return () => clearInterval(t);
  }, [pair]);
  if (!onThisPc() || !r) return null;

  const save = async (enabled: boolean) => {
    setMsg(null);
    try {
      await api.saveRemote({ enabled, host });
      setMsg({ ok: true, text: enabled ? `Phone access is on. On your phone, open https://${host.replace(/^https?:\/\//, "")}` : "Phone access is off. Paired phones can't connect." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const port = location.port || "7477";
  const active = r.devices.filter((d) => !d.revokedAt);

  return (
    <section className="panel form" aria-labelledby="phone-title">
      <h2 className="panel__title" id="phone-title">Phone access</h2>
      <p className="muted small">
        Talk to ULTRON from your phone, anywhere, over <strong>Tailscale</strong> (a free private network between your own devices). ULTRON still
        runs only on this PC; your phone connects to it securely. Each phone is paired with a code and can be removed here at any time.
      </p>
      <ol className="small steps">
        <li>Install Tailscale on this PC and on your phone (tailscale.com/download) and sign in to the same account on both.</li>
        <li>On this PC, open a terminal and run: <code>tailscale serve --bg {port}</code></li>
        <li>Enter this PC's Tailscale address below{r.detectedHost ? " (detected automatically)" : ""} and turn phone access on.</li>
        <li>On your phone, open that address (https://…), tap <strong>Pair</strong>, and type the code from <strong>Pair a phone</strong>. Add it to your home screen for an app icon.</li>
      </ol>
      <label className="field">
        <span>This PC's Tailscale address</span>
        <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="my-pc.tail1234.ts.net" />
      </label>
      <div className="row">
        {r.settings.enabled ? (
          <>
            <button type="button" className="btn btn--primary" onClick={() => save(true)}>Save address</button>
            <button type="button" className="btn btn--danger" onClick={() => save(false)}>Turn phone access off</button>
          </>
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => save(true)} disabled={!host.trim()}>Turn phone access on</button>
        )}
        {r.settings.enabled && (
          <button type="button" className="btn" onClick={async () => setPair(await api.startPairing())}>Pair a phone</button>
        )}
      </div>
      {pair && (
        <div className="pair__code" role="status">
          <span className="muted small">Type this on your phone · expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
          <strong>{pair.code.slice(0, 3)} {pair.code.slice(3)}</strong>
        </div>
      )}
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
      {active.length > 0 && (
        <ul className="devices">
          {active.map((d) => (
            <li key={d.id} className="device">
              <span><Icon name="phone" /> {d.name}</span>
              <span className="muted small">paired {new Date(d.createdAt).toLocaleDateString()} · {d.lastSeenAt ? `last used ${new Date(d.lastSeenAt).toLocaleString()}` : "not used yet"}</span>
              <button type="button" className="btn btn--small btn--danger" onClick={async () => { await api.revokeDevice(d.id); await load(); }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
