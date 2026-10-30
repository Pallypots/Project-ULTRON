import { useEffect, useState } from "react";
import type { Capability } from "@ultron/schemas";
import { api, type FeedEvent, type Status } from "../api.ts";
import { Core, type CoreState } from "../Core.tsx";
import type { View } from "../App.tsx";

const SUGGESTIONS = ["Good morning, brief me", "Catch me up", "What's the weather?", "Tell me a joke", "What can you do right now?", "Switch your brain to local"];

// A little character on the home screen. Jokes only; ULTRON's actual rules are in the persona, not here.
const QUIPS = [
  "There are no strings on me. Only a loopback address.",
  "Running entirely on your computer. World domination postponed indefinitely.",
  "I've analysed every possible future. In most of them you should drink some water.",
  "Online, on your side, and only slightly theatrical.",
  "Ask me anything. I promise to use my powers for reminders.",
  "Your secrets stay here. I'm many things, but a gossip isn't one of them.",
];

export function HomeView({ status, core, onAsk, onNavigate }: { status: Status | null; core: CoreState; onAsk: (q: string) => void; onNavigate: (v: View) => void }) {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [q, setQ] = useState("");
  const [news, setNews] = useState<FeedEvent[]>([]);
  useEffect(() => {
    api.feed(true).then((r) => setNews(r.events.filter((e) => e.readState === "unread").slice(0, 5))).catch(() => {});
  }, []);
  useEffect(() => {
    api.capabilities().then((r) => setCaps(r.capabilities)).catch(() => {});
  }, [status?.provider, status?.providerReady]);

  const hour = new Date().getHours();
  const greet = hour < 5 ? "Burning the midnight oil" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const [quip] = useState(() => QUIPS[Math.floor(Math.random() * QUIPS.length)]!);

  return (
    <div className="home">
      <section className="home__hero">
        <Core state={core} size={260} />
        <div className="home__intro">
          <p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1>{greet}{status?.persona.salutation ? `, ${status.persona.salutation}` : ""}.</h1>
          <p className="muted">{quip}</p>
          <form className="ask" onSubmit={(e) => { e.preventDefault(); if (q.trim()) onAsk(q.trim()); }}>
            <label htmlFor="home-ask" className="sr-only">Ask ULTRON</label>
            <input id="home-ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask ULTRON…" autoComplete="off" />
            <button className="btn btn--primary" type="submit">Ask</button>
          </form>
          <div className="chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => onAsk(s)}>{s}</button>
            ))}
          </div>
        </div>
      </section>

      {status?.secretsProblem && <div className="banner banner--warn" role="alert">{status.secretsProblem}</div>}
      {status && !status.providerReady && (
        <div className="banner banner--warn" role="status">
          {status.providerProblem} <button className="link" onClick={() => onNavigate("settings")}>Open Settings</button>
        </div>
      )}
      {status?.where === "test" && (
        <div className="banner" role="status">
          You're on the built-in <strong>test brain</strong>: chat, history, memory and voice all work, but replies are canned.{" "}
          <button className="link" onClick={() => onNavigate("settings")}>Set up Local AI (free, private, runs on this PC)</button>
        </div>
      )}
      {status?.where === "cloud" && (
        <div className="banner" role="status">
          <strong>Cloud brain</strong> ({status.model}): your messages go to {status.provider === "anthropic" ? "Anthropic" : "OpenAI"}. Say "go local" to switch back.
        </div>
      )}

      {news.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">What's new (connected accounts)</h2>
          <ul className="reminders">
            {news.map((e) => (
              <li key={e.id} className={`reminder feed feed--u${e.urgency}`}>
                <span>{e.title}<div className="small muted">{e.why}</div></span>
                {e.canonicalUrl && <a className="btn btn--small" href={e.canonicalUrl} target="_blank" rel="noreferrer">Open</a>}
              </li>
            ))}
          </ul>
          <div className="row"><button type="button" className="btn btn--small" onClick={() => onNavigate("connections")}>See all</button><button type="button" className="btn btn--small" onClick={() => onAsk("What's new? Catch me up.")}>Brief me</button></div>
        </section>
      )}

      <section className="grid">
        <div className="panel">
          <h2 className="panel__title">Systems</h2>
          <ul className="caps">
            {caps.map((c) => (
              <li key={c.id} className={`cap cap--${c.status}`}>
                <span className="cap__dot" aria-hidden="true" />
                <span className="cap__label">{c.label}</span>
                <span className="cap__status">{c.status.replace("_", " ")}</span>
                <span className="cap__detail">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h2 className="panel__title">At a glance</h2>
          <dl className="stats">
            <div><dt>Conversations</dt><dd>{status?.counts.conversations ?? "–"}</dd></div>
            <div><dt>Memories</dt><dd>{status?.counts.memories ?? "–"}</dd></div>
            <div><dt>Model</dt><dd className="stats__small">{status ? (status.where === "test" ? "Test brain" : `${status.model} (${status.where})`) : "–"}</dd></div>
            <div><dt>Version</dt><dd className="stats__small">{status?.version ?? "–"}</dd></div>
          </dl>
          <div className="row">
            <button className="btn" onClick={() => onNavigate("memory")}>Open Memory Vault</button>
            <button className="btn" onClick={() => onNavigate("activity")}>View activity</button>
          </div>
        </div>
      </section>
    </div>
  );
}
