import { useEffect, useState } from "react";
import { api, onThisPc } from "../api.ts";

/** Settings → Web search: optional Brave Search key (free plan available). Keys are entered here, never in chat. */
export function SearchSettings() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.searchSettings().then((r) => setConfigured(r.configured)).catch(() => {});
  }, []);
  if (configured === null) return null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.saveSearchKey(key.trim());
      setConfigured(true);
      setKey("");
      setMsg({ ok: true, text: 'Web search is on. Try "search the web for today\'s tech news".' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel form" aria-labelledby="search-title">
      <h2 className="panel__title" id="search-title">Web search {configured ? "· on" : ""}</h2>
      <p className="muted small">
        Lets ULTRON look things up on the web (news, prices, opening hours…). Searches go to <strong>Brave Search</strong>; everything else stays on
        this PC. Without it, ULTRON uses Wikipedia and pages you paste.
      </p>
      {configured ? (
        onThisPc() && (
          <button type="button" className="btn btn--danger" onClick={async () => { await api.removeSearchKey(); setConfigured(false); setMsg({ ok: true, text: "Web search turned off and the key deleted." }); }}>
            Remove key
          </button>
        )
      ) : onThisPc() ? (
        <form className="form" onSubmit={save}>
          <ol className="small steps">
            <li>Go to <strong>brave.com/search/api</strong>, sign up and choose the <strong>Free</strong> plan (about 2,000 searches a month).</li>
            <li>Copy your API key and paste it here (never in chat). ULTRON checks it works before saving it encrypted.</li>
          </ol>
          <label className="field">
            <span>Brave Search API key</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          </label>
          <button className="btn btn--primary" type="submit" disabled={busy || key.trim().length < 10}>{busy ? "Checking…" : "Save key"}</button>
        </form>
      ) : (
        <p className="muted small">Add the key on the PC.</p>
      )}
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
    </section>
  );
}
