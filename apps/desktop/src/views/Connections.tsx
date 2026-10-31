import { useEffect, useState } from "react";
import { CalendarPanel } from "./CalendarPanel.tsx";
import { api, type ConnectorInfo, type FeedEvent } from "../api.ts";

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString();
};
const ICON: Record<string, string> = { commit: "⬤", pull_request: "⇄", issue: "!", workflow_run: "✖", release: "★" };

export function ConnectionsView({ onAsk }: { onAsk: (q: string) => void }) {
  const [list, setList] = useState<ConnectorInfo[]>([]);
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState<{ fullName: string; private: boolean }[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "important">("all");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api.connectors();
    setList(r.connectors);
    setChosen(new Set(r.connectors[0]?.repos ?? []));
    setFeed((await api.feed(filter === "important")).events);
  };
  useEffect(() => {
    load().catch(() => {});
  }, [filter]);
  useEffect(() => {
    const onSync = () => load().catch(() => {});
    window.addEventListener("ultron-connector", onSync);
    return () => window.removeEventListener("ultron-connector", onSync);
  }, [filter]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ ok: true, text: ok });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const gh = list.find((c) => c.id === "github");
  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Connections</h1>
          <p className="muted">
            Accounts ULTRON can read so it can brief you ("what's new on my game port?"). Each connection is read-only unless stated, shows exactly what it can
            see, and can be disconnected, which deletes everything ULTRON stored from it. ULTRON never says an account is connected until a real read test passes.
          </p>
        </div>
      </header>

      {gh && (
        <section className="panel form" aria-labelledby="gh-title">
          <h2 className="panel__title" id="gh-title">GitHub {gh.connected ? `· @${gh.account}` : ""}</h2>
          <p className="small muted">{gh.note}</p>
          {!gh.connected ? (
            <>
              <ol className="small steps">
                <li>
                  Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">GitHub → Fine-grained token</a>. Name it "ULTRON",
                  pick an expiry, and under <em>Repository access</em> choose only the repos you want ULTRON to watch.
                </li>
                <li>
                  Under <em>Permissions</em> set these to <strong>Read-only</strong>: Contents, Issues, Pull requests, Actions (Metadata is automatic). Nothing else.
                </li>
                <li>Generate, copy the token, paste it below. It's stored only on this PC and never shown again (don't paste it into chat).</li>
              </ol>
              <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => api.connectGithub(token.trim()).then(() => setToken("")), "Connected. Now pick the repos to watch."); }}>
                <label htmlFor="gh-token" className="sr-only">GitHub token</label>
                <input id="gh-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" style={{ flex: 1 }} required />
                <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? "Testing…" : "Connect"}</button>
              </form>
            </>
          ) : (
            <>
              <div className={`banner ${gh.health === "ok" ? "banner--ok" : gh.health === "syncing" ? "" : "banner--warn"}`} role="status">
                <strong>{gh.health === "ok" ? "Healthy" : gh.health === "rate_limited" ? "Rate limited" : gh.health === "syncing" ? "Syncing" : "Problem"}</strong> · last sync {ago(gh.lastSyncAt)}
                {gh.nextSyncAt ? ` · next check ${new Date(gh.nextSyncAt).toLocaleTimeString()}` : ""}. {gh.healthDetail}
              </div>
              <div className="eyebrow">Watching {gh.repos?.length ?? 0} repo{gh.repos?.length === 1 ? "" : "s"}{gh.repos?.length ? `: ${gh.repos.join(", ")}` : ""}</div>
              {repos ? (
                <>
                  <ul className="models">
                    {repos.map((r) => (
                      <li key={r.fullName}>
                        <label className="toggle">
                          <input type="checkbox" checked={chosen.has(r.fullName)} onChange={(e) => { const n = new Set(chosen); e.target.checked ? n.add(r.fullName) : n.delete(r.fullName); setChosen(n); }} />
                          <span className="mono">{r.fullName}</span>
                        </label>
                        {r.private && <span className="tag">private</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="row">
                    <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(async () => { await api.setGithubRepos([...chosen]); setRepos(null); await api.syncGithub(); }, "Saved and synced.")}>Save & sync</button>
                    <button type="button" className="btn" onClick={() => setRepos(null)}>Cancel</button>
                  </div>
                </>
              ) : (
                <div className="row">
                  <button type="button" className="btn" disabled={busy} onClick={() => run(async () => setRepos((await api.githubRepos()).repos))}>Choose repos</button>
                  <button type="button" className="btn btn--primary" disabled={busy || !gh.repos?.length} onClick={() => run(() => api.syncGithub(), "Synced.")}>Sync now</button>
                  <button type="button" className="btn btn--danger" onClick={() => { if (confirm("Disconnect GitHub? The token and every update ULTRON stored from GitHub will be deleted.")) run(() => api.disconnectGithub(), "Disconnected; GitHub data deleted."); }}>Disconnect</button>
                </div>
              )}
            </>
          )}
          {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
        </section>
      )}

      <CalendarPanel onAsk={onAsk} />

      <section className="panel">
        <h2 className="panel__title">Coming next</h2>
        <ul className="reminders">
          {list.filter((c) => !c.available).map((c) => (
            <li key={c.id} className="reminder reminder--past"><span><strong>{c.label}</strong></span><span className="small muted">{c.note}</span></li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="panel__title">Feed</h2>
          <div className="row">
            <button type="button" className={`chip ${filter === "all" ? "chip--on" : ""}`} onClick={() => setFilter("all")}>All</button>
            <button type="button" className={`chip ${filter === "important" ? "chip--on" : ""}`} onClick={() => setFilter("important")}>Important</button>
            {feed.some((e) => e.readState === "unread") && <button type="button" className="chip" onClick={() => run(() => api.markFeedRead("all"))}>Mark all read</button>}
          </div>
        </div>
        {feed.length === 0 ? (
          <p className="empty">{gh?.connected ? "Nothing yet. Sync to fetch updates." : "Connect an account to see updates here."}</p>
        ) : (
          <ul className="reminders">
            {feed.map((e) => (
              <li key={e.id} className={`reminder feed feed--u${e.urgency} ${e.readState === "unread" ? "feed--unread" : ""}`}>
                <span>
                  <span className="feed__icon" aria-hidden="true">{ICON[e.resourceType] ?? "•"}</span> {e.title}
                  <div className="small muted">{e.summary} · {ago(e.occurredAt)} · <span title="Why ULTRON surfaced this">{e.why}</span></div>
                </span>
                <span className="row">
                  {e.canonicalUrl && <a className="btn btn--small" href={e.canonicalUrl} target="_blank" rel="noreferrer">Open source</a>}
                  <button type="button" className="btn btn--small" onClick={() => onAsk(`Tell me about this GitHub update: ${e.title}${e.canonicalUrl ? ` (${e.canonicalUrl})` : ""}`)}>Ask ULTRON</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
