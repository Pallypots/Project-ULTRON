import { useEffect, useState } from "react";
import { api, onThisPc, type SearchStatus } from "../api.ts";

/**
 * Settings → Web search. Two ways, both optional: the owner's own SearXNG (free, no account) or a Brave Search key.
 * Keys and addresses are entered here, never in chat, and ULTRON checks each one works before saving it.
 */
export function SearchSettings() {
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [way, setWay] = useState<"searxng" | "brave">("searxng");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.searchSettings().then(setStatus).catch(() => {});
  }, []);
  if (!status) return null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      setStatus(way === "searxng" ? await api.saveSearxng(value.trim()) : await api.saveSearchKey(value.trim()));
      setValue("");
      setMsg({ ok: true, text: 'Web search is on. Try "search the web for today\'s tech news".' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const using = status.engine === "searxng" ? `your SearXNG (${status.searxngUrl})` : "Brave Search";
  return (
    <section className="panel form" aria-labelledby="search-title">
      <h2 className="panel__title" id="search-title">Web search {status.configured ? "· on" : ""}</h2>
      <p className="muted small">
        Lets ULTRON look things up on the web (news, prices, opening hours, research…). Without it, ULTRON uses Wikipedia and pages you paste.
      </p>
      {status.configured ? (
        <>
          <p className="small">Searching with <strong>{using}</strong>.</p>
          {onThisPc() && (
            <button type="button" className="btn btn--danger" onClick={async () => { setStatus(await api.removeSearchKey()); setMsg({ ok: true, text: "Web search turned off." }); }}>
              Turn off web search
            </button>
          )}
        </>
      ) : onThisPc() ? (
        <form className="form" onSubmit={save}>
          <div className="row" role="radiogroup" aria-label="How to search">
            <label className="toggle"><input type="radio" name="search-way" checked={way === "searxng"} onChange={() => { setWay("searxng"); setValue(""); }} /> Free: my own SearXNG</label>
            <label className="toggle"><input type="radio" name="search-way" checked={way === "brave"} onChange={() => { setWay("brave"); setValue(""); }} /> Brave Search key</label>
          </div>
          {way === "searxng" ? (
            <>
              <ol className="small steps">
                <li>SearXNG is a free search engine you run yourself; it asks Google, Bing, DuckDuckGo and others for you. No account, no limits.</li>
                <li>The easy way is Docker Desktop: run <code>docker run -d -p 8888:8080 searxng/searxng</code>.</li>
                <li>In SearXNG's <code>settings.yml</code>, add <code>json</code> under <code>search → formats</code> and restart it.</li>
                <li>Enter its address below. ULTRON tries a search before saving.</li>
              </ol>
              <label className="field">
                <span>SearXNG address</span>
                <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="http://localhost:8888" autoComplete="off" />
              </label>
              <button className="btn btn--primary" type="submit" disabled={busy || value.trim().length < 3}>{busy ? "Checking…" : "Connect SearXNG"}</button>
            </>
          ) : (
            <>
              <ol className="small steps">
                <li>Go to <strong>brave.com/search/api</strong>, sign up and choose the <strong>Free</strong> plan (about 2,000 searches a month).</li>
                <li>Copy your API key and paste it here (never in chat). ULTRON checks it works before saving it encrypted. Searches then go to Brave.</li>
              </ol>
              <label className="field">
                <span>Brave Search API key</span>
                <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
              </label>
              <button className="btn btn--primary" type="submit" disabled={busy || value.trim().length < 10}>{busy ? "Checking…" : "Save key"}</button>
            </>
          )}
        </form>
      ) : (
        <p className="muted small">Set this up on the PC.</p>
      )}
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
    </section>
  );
}
