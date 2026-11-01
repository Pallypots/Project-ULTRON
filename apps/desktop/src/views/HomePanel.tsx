import { useEffect, useState } from "react";
import { api, onThisPc, type HomeStatus } from "../api.ts";

/** Connections → Home: the owner's own Home Assistant, for "Ultron, lights off". Token entered here, never in chat. */
export function HomePanel({ onAsk }: { onAsk: (q: string) => void }) {
  const [s, setS] = useState<HomeStatus | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<{ id: string; domain: string; name: string; summary: string }[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api.home().then((r) => setS(r.home)).catch(() => {});
  }, []);
  useEffect(() => {
    if (s?.connected) api.homeDevices().then((r) => setDevices(r.devices)).catch(() => {});
  }, [s?.connected]);
  if (!s) return null;
  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.connectHome(url.trim(), token.trim());
      setS(r.home);
      setToken("");
      setMsg({ ok: true, text: `Connected: ${r.devices} device${r.devices === 1 ? "" : "s"} ULTRON can control. Try "Ultron, lights off".` });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel form" aria-labelledby="home-title">
      <h2 className="panel__title" id="home-title">Smart home {s.connected ? `· ${s.devices} devices` : ""}</h2>
      {s.connected ? (
        <>
          <p className="muted small">
            Connected to Home Assistant at {s.url}. Lights, plugs, fans, TVs, heating, scenes and vacuums: just ask. Garage doors, gates, blinds and
            scripts wait for your approval. Locks and alarms are never controlled.
          </p>
          {s.error && <div className="banner banner--warn" role="status">{s.error}</div>}
          {devices.length > 0 && (
            <ul className="hud-feed" aria-label="Devices">
              {devices.slice(0, 30).map((d) => (
                <li key={d.id} className="hud-feed__item"><span className="hud-feed__t">{d.domain.replace("_", " ").toUpperCase()}</span> {d.summary}</li>
              ))}
            </ul>
          )}
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => onAsk("Which lights are on?")}>Which lights are on?</button>
            {onThisPc() && (
              <button type="button" className="btn btn--danger" onClick={async () => { setS((await api.disconnectHome()).home); setDevices([]); setMsg({ ok: true, text: "Home Assistant disconnected and its token deleted." }); }}>
                Disconnect
              </button>
            )}
          </div>
        </>
      ) : onThisPc() ? (
        <form onSubmit={connect} className="form">
          <p className="muted small">
            Control your lights and devices by voice through <strong>Home Assistant</strong> (free; it works with Hue, IKEA, TP-Link, Shelly, Nest and
            thousands more). The token stays encrypted on this PC; enter it here, never in chat.
          </p>
          <ol className="small steps">
            <li>In Home Assistant, click your name (bottom left) → <strong>Security</strong> → <strong>Long-lived access tokens</strong> → Create token, name it "ULTRON".</li>
            <li>Copy the token and paste it below with your Home Assistant address.</li>
          </ol>
          <label className="field">
            <span>Home Assistant address</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" autoComplete="off" spellCheck={false} />
          </label>
          <label className="field">
            <span>Long-lived access token</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </label>
          <button className="btn btn--primary" type="submit" disabled={busy || url.trim().length < 3 || token.trim().length < 20}>{busy ? "Checking…" : "Connect Home Assistant"}</button>
        </form>
      ) : (
        <p className="muted small">Connect Home Assistant on the PC (Connections → Smart home).</p>
      )}
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
    </section>
  );
}
