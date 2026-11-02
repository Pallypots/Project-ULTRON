import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../icons.tsx";
import { Speaker, type TtsEngineId } from "../voice/speaker.ts";
import { loadVoicePrefs } from "../voice/prefs.ts";
import type { Capability } from "@ultron/schemas";
import { api, type Hud, type Status } from "../api.ts";
import type { CoreState } from "../Core.tsx";
import type { View } from "../App.tsx";
import { Reactor, type ReactorCommand } from "../hud/Reactor.tsx";
import { Gauge } from "../hud/Gauge.tsx";
import { SetupCard } from "../hud/SetupCard.tsx";

const QUICK = ["Good morning, brief me", "Catch me up", "What's the weather?", "What's on my calendar today?", "Tell me a joke", "What can you do right now?"];

// A little character on the home screen. Jokes only; ULTRON's actual rules are in the persona, not here.
const QUIPS = [
  "There are no strings on me. Only a loopback address.",
  "Running entirely on your computer. World domination postponed indefinitely.",
  "I've analysed every possible future. In most of them you should drink some water.",
  "Online, on your side, and only slightly theatrical.",
  "Ask me anything. I promise to use my powers for reminders.",
  "Your secrets stay here. I'm many things, but a gossip isn't one of them.",
];

const gb = (b: number) => `${(b / 1e9).toFixed(b > 1e11 ? 0 : 1)} GB`;
const dur = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);
const hm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Panel({ title, badge, children, className = "" }: { title: string; badge?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const id = `p-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className={`hud-panel ${className}`} aria-labelledby={id}>
      <h2 className="hud-panel__title" id={id}>
        <span>{title}</span>
        {badge}
      </h2>
      {children}
    </section>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function HomeView({ status, core, onAsk, onTalk, onCouncil, onNavigate }: { status: Status | null; core: CoreState; onAsk: (q: string) => void; onTalk: () => void; onCouncil: () => void; onNavigate: (v: View) => void }) {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [q, setQ] = useState("");
  const [hud, setHud] = useState<Hud | null>(null);
  const now = useClock();
  useEffect(() => {
    api.capabilities().then((r) => setCaps(r.capabilities)).catch(() => {});
  }, [status?.provider, status?.providerReady]);
  useEffect(() => {
    let live = true;
    const load = () => api.hud().then((h) => live && setHud(h)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const hour = now.getHours();
  const greet = hour < 5 ? "Burning the midnight oil" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const [quip] = useState(() => QUIPS[Math.floor(Math.random() * QUIPS.length)]!);
  // After an update: what's new since the version the owner last saw (once).
  const [updates, setUpdates] = useState<Awaited<ReturnType<typeof api.whatsNew>> | null>(null);
  useEffect(() => {
    api.whatsNew().then((n) => (n.firstRun ? api.whatsNewSeen() : n.sections.length ? setUpdates(n) : null)).catch(() => {});
  }, []);
  const plain = (s: string) => s.replace(/\*\*|`/g, "");

  // Spoken on request: browsers only allow sound after a click, so the greeting has a play button.
  const speaker = useRef<Speaker | null>(null);
  const voice = useRef<{ engine: TtsEngineId; speed: number }>({ engine: "local", speed: 1 });
  useEffect(() => () => speaker.current?.stop(), []);
  const sayHello = async () => {
    if (!hello) return;
    const s = await api.ttsStatus().catch(() => null);
    if (s) voice.current = { engine: s.engine, speed: s.speed };
    speaker.current ??= new Speaker(() => voice.current.engine, () => loadVoicePrefs().browserVoice, () => voice.current.speed);
    speaker.current.unlock();
    speaker.current.stop();
    speaker.current.enqueue(hello.match(/[^.!?]+[.!?]*/g) ?? [hello]);
  };
  // ULTRON speaks first: a catch-up line from the current brain (may take a while on a slow local model).
  const [hello, setHello] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.greeting().then((r) => live && setHello(r.greeting?.text ?? null)).catch(() => {});
    return () => { live = false; };
  }, [status?.provider]);

  const sys = hud?.system;
  const ramPct = sys ? Math.round((sys.ram.used / sys.ram.total) * 100) : 0;
  const diskPct = sys?.disk ? Math.round((sys.disk.used / sys.disk.total) * 100) : null;
  const commands: ReactorCommand[] = [
    { label: "BRIEF", title: "Morning briefing", run: () => onAsk("Good morning, brief me") },
    { label: "WEATHER", title: "Weather", run: () => onAsk("What's the weather?") },
    { label: "AGENDA", title: "Today's calendar", run: () => onAsk("What's on my calendar today?") },
    { label: "TO-DO", title: "My to-do list", run: () => onAsk("What's on my list?") },
    { label: "NEWS", title: "News headlines", run: () => onAsk("What's the news?") },
    { label: "MEDIA", title: "Play or pause music", run: () => onAsk("pause") },
    { label: "SCREEN", title: "Look at my screen", run: () => onAsk("Look at my screen and tell me what you see") },
    { label: "SYSTEM", title: "How is my PC doing?", run: () => onAsk("How's my PC doing?") },
    { label: "JOKE", title: "Tell me a joke", run: () => onAsk("Tell me a joke") },
    { label: "SKILLS", title: "What can you do?", run: () => onAsk("What can you do right now?") },
    { label: "COUNCIL", title: "Council mode: talk face to face", run: onCouncil },
    { label: "TALK", title: "Talk to ULTRON", run: onTalk },
  ];
  const ready = status?.providerReady !== false;
  const feedCount = (hud?.pendingApprovals.length ?? 0) + (hud?.reminders.length ?? 0) + (hud?.feed.length ?? 0) + (hud?.email?.unread.length ?? 0);

  return (
    <div className="hud">
      <header className="hud__top">
        <div className="hud__id">
          <div className="hud__brand">U L T R O N</div>
          <div className={`hud__sys ${ready ? "" : "hud__sys--warn"}`}>
            <i aria-hidden="true" /> SYSTEM STATUS · {status ? (ready ? "OPTIMAL" : "ATTENTION") : "…"}
          </div>
        </div>
        <div className="hud__clock" aria-label="Current time">
          <div className="hud__time">{now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
          <div className="hud__date">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
        <div className="hud__brain">
          <div className="hud__k">NEURAL CORE</div>
          <div className="hud__v">{status ? (status.where === "test" ? "Test brain" : `${status.model}`) : "–"}</div>
          <div className="hud__k">{status?.where === "local" ? "LOCAL · PRIVATE" : status?.where === "cloud" ? "CLOUD" : "OFFLINE MODE"}</div>
        </div>
      </header>

      <SetupCard status={status} hud={hud} onNavigate={onNavigate} onTalk={onTalk} />
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
      {updates && (
        <section className="hud-panel news" aria-labelledby="news-title">
          <h2 className="hud-panel__title" id="news-title">
            <span>UPGRADE INSTALLED · v{updates.version}</span>
            <button type="button" className="btn btn--small" onClick={() => { api.whatsNewSeen().catch(() => {}); setUpdates(null); }}>Got it</button>
          </h2>
          <ul>
            {updates.sections.flatMap((s) => s.items).slice(0, 6).map((it, i) => (
              <li key={i}>{plain(it).slice(0, 200)}{plain(it).length > 200 ? "…" : ""}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="hud__grid">
        <div className="hud__col">
          <Panel title="AI CORE" badge={<span className="hud-badge">{caps.filter((c) => c.status === "enabled").length}/{caps.length} ONLINE</span>}>
            <ul className="hud-caps">
              {caps.map((c) => (
                <li key={c.id} className={`hud-cap hud-cap--${c.status}`} title={c.detail ?? undefined}>
                  <i aria-hidden="true" />
                  <span>{c.label}</span>
                  <em>{c.status.replace("_", " ")}</em>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="SYSTEM MONITOR">
            <div className="gauges">
              <Gauge label="CPU" value={sys ? sys.cpu : null} detail={sys ? `${sys.cpuThreads} threads` : undefined} />
              <Gauge label="RAM" value={sys ? ramPct : null} detail={sys ? `${gb(sys.ram.used)} / ${gb(sys.ram.total)}` : undefined} />
              <Gauge label="DISK" value={diskPct} detail={sys?.disk ? `${gb(sys.disk.total - sys.disk.used)} free` : undefined} />
            </div>
            <dl className="hud-kv">
              <div><dt>PC UPTIME</dt><dd>{sys ? dur(sys.pcUptimeSec) : "–"}</dd></div>
              <div><dt>ULTRON UPTIME</dt><dd>{sys ? dur(sys.ultronUptimeSec) : "–"}</dd></div>
              <div><dt>MEMORIES</dt><dd>{hud?.memories ?? "–"}</dd></div>
              <div><dt>WATCHING</dt><dd>{hud ? `${hud.watchers} page${hud.watchers === 1 ? "" : "s"}` : "–"}</dd></div>
            </dl>
          </Panel>
        </div>

        <div className="hud__center">
          <Reactor state={core} cpu={sys?.cpu ?? 0} ram={ramPct} commands={commands} time={now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} />
          <div className="hud__greeting">
            <h1>{greet}{status?.persona.salutation ? `, ${status.persona.salutation}` : ""}.</h1>
            <p className="muted">{quip}</p>
            {hello && (
              <div className="hello" role="status">
                <span className="hello__who">
                  ULTRON
                  <button type="button" className="hello__play" onClick={sayHello} aria-label="Say it out loud" title="Say it out loud"><Icon name="speaker" /></button>
                </span>
                <span className="hello__text">{hello}</span>
              </div>
            )}
          </div>
        </div>

        <div className="hud__col">
          <Panel title="ENVIRONMENT">
            {hud?.weather ? (
              <div className="wx">
                <div className="wx__now">
                  <span className="wx__temp">{hud.weather.now.temperature}</span>
                  <span>
                    <strong>{hud.weather.now.conditions}</strong>
                    <span className="small muted">{hud.weather.place.split(",")[0]} · feels {hud.weather.now.feels_like} · wind {hud.weather.now.wind}</span>
                  </span>
                </div>
                <ul className="wx__days">
                  {hud.weather.nextDays.slice(1, 3).map((d) => (
                    <li key={d.day}><span>{new Date(d.day + "T12:00").toLocaleDateString(undefined, { weekday: "short" })}</span><span>{d.conditions}</span><span>{d.high} / {d.low}</span></li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="small muted">
                {hud?.homeLocationSet ? "Fetching the weather…" : <>Set your city in <button className="link" onClick={() => onNavigate("settings")}>Settings → Personality</button> to see the weather here.</>}
              </p>
            )}
          </Panel>
          {hud?.home && (
            <Panel title="HOME SYSTEMS">
              <dl className="hud-kv">
                <div><dt>LIGHTS ON</dt><dd>{hud.home.lightsOn.length} / {hud.home.lights}</dd></div>
                {hud.home.heating && <div><dt>{hud.home.heating.name.toUpperCase()}</dt><dd>{String(hud.home.heating.current ?? "–")}° → {String(hud.home.heating.target ?? "–")}°</dd></div>}
              </dl>
              {hud.home.lightsOn.length > 0 && <p className="small muted" style={{ margin: "8px 0 0" }}>{hud.home.lightsOn.slice(0, 4).join(", ")}{hud.home.lightsOn.length > 4 ? "…" : ""}</p>}
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn--small" onClick={() => onAsk("turn off the lights")}>All lights off</button>
              </div>
            </Panel>
          )}
          <Panel title="LIVE INTELLIGENCE FEED" badge={feedCount ? <span className="hud-badge hud-badge--live">LIVE · {feedCount}</span> : <span className="hud-badge">QUIET</span>}>
            <ul className="hud-feed">
              {hud?.pendingApprovals.map((a) => (
                <li key={a.id} className="hud-feed__item hud-feed__item--warn">
                  <button className="link" onClick={() => onNavigate("activity")}>Waiting for approval: {a.summary}</button>
                </li>
              ))}
              {hud?.reminders.map((r) => (
                <li key={r.id} className="hud-feed__item"><span className="hud-feed__t">{hm(r.dueAt)}</span> <Icon name="reminder" /> {r.text}</li>
              ))}
              {hud?.email?.unread.map((m, i) => (
                <li key={`mail-${i}`} className="hud-feed__item"><span className="hud-feed__t">MAIL</span> {m.from}: {m.subject}</li>
              ))}
              {hud?.feed.map((e) => (
                <li key={e.id} className="hud-feed__item">
                  <span className="hud-feed__t">{e.source.toUpperCase()}</span> {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> : e.title}
                </li>
              ))}
              {hud && !feedCount && <li className="hud-feed__item muted">All quiet. Nothing needs you right now.</li>}
            </ul>
          </Panel>
          <Panel title="MISSION TIMELINE" badge={<span className="hud-badge">TODAY</span>}>
            <ul className="hud-feed">
              {hud?.agenda.map((e, i) => (
                <li key={i} className="hud-feed__item"><span className="hud-feed__t">{e.allDay ? "ALL DAY" : hm(e.start)}</span> {e.title}</li>
              ))}
              {hud && !hud.calendarConnected && <li className="hud-feed__item muted">No calendar linked. <button className="link" onClick={() => onNavigate("connections")}>Connect one</button></li>}
              {hud?.calendarConnected && !hud.agenda.length && <li className="hud-feed__item muted">Nothing on the calendar today.</li>}
              {hud?.todos.top.map((t) => (
                <li key={t.id} className="hud-feed__item"><span className="hud-feed__t">TO-DO</span> {t.text}</li>
              ))}
              {hud && hud.todos.open > hud.todos.top.length && <li className="hud-feed__item muted">+{hud.todos.open - hud.todos.top.length} more on your list</li>}
            </ul>
          </Panel>
        </div>
      </div>

      <footer className="hud__bottom">
        <div className="chips" aria-label="Quick commands">
          {QUICK.map((s) => (
            <button key={s} className="chip" onClick={() => onAsk(s)}>{s}</button>
          ))}
        </div>
        <div className="hud__console">
          <form className="ask" onSubmit={(e) => { e.preventDefault(); if (q.trim()) onAsk(q.trim()); }}>
            <label htmlFor="home-ask" className="sr-only">Ask ULTRON</label>
            <input id="home-ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask ULTRON…" autoComplete="off" />
            <button className="btn btn--primary" type="submit">Ask</button>
          </form>
          <button type="button" className="btn talk-btn" onClick={onTalk} title="Opens a conversation and listens: just speak. Say &quot;that's all&quot; when you're done.">
            <Icon name="mic" /> Talk to ULTRON
          </button>
          <button type="button" className="btn council-btn" onClick={onCouncil} title="Full screen, face to face, always listening">
            <Icon name="council" /> Council mode
          </button>
        </div>
      </footer>
    </div>
  );
}
