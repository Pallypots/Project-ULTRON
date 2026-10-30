import { useCallback, useEffect, useState } from "react";
import { api, health, type Status } from "./api.ts";
import type { CoreState } from "./Core.tsx";
import { useUiPrefs } from "./prefs.ts";
import { HomeView } from "./views/Home.tsx";
import { ChatView } from "./views/Chat.tsx";
import { MemoryView } from "./views/Memory.tsx";
import { ActivityView } from "./views/Activity.tsx";
import { SettingsView } from "./views/Settings.tsx";

export type View = "home" | "chat" | "memory" | "activity" | "settings";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "◎" },
  { id: "chat", label: "Chat", icon: "✦" },
  { id: "memory", label: "Memory Vault", icon: "▣" },
  { id: "activity", label: "Activity", icon: "≡" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export function App() {
  const [view, setView] = useState<View>(() => (location.hash.slice(1) as View) || "home");
  const [online, setOnline] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [coreState, setCoreState] = useState<CoreState>("idle");
  const [prefs, setPrefs] = useUiPrefs();
  const [chatSeed, setChatSeed] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const ok = await health();
    setOnline(ok);
    if (ok) setStatus(await api.status().catch(() => null));
  }, []);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 5000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  useEffect(() => {
    location.hash = view;
  }, [view]);

  const go = (v: View) => setView(v);
  const effectiveCore: CoreState = online === false ? "offline" : coreState;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <nav className="nav" aria-label="Main">
        <div className="brand">
          <img src="/ultron.svg" alt="" width={30} height={30} />
          <span>ULTRON</span>
        </div>
        {NAV.map((n) => (
          <button key={n.id} className={`nav__item ${view === n.id ? "is-active" : ""}`} aria-current={view === n.id ? "page" : undefined} onClick={() => go(n.id)}>
            <span className="nav__icon" aria-hidden="true">{n.icon}</span>
            <span className="nav__label">{n.label}</span>
          </button>
        ))}
        <div className="nav__footer">
          <ConnectionPill online={online} status={status} />
          <button className="btn btn--danger btn--block" onClick={() => api.stopAll().catch(() => {})} title="Stop every in-progress reply immediately">
            ■ Stop all
          </button>
        </div>
      </nav>
      <main id="main" className="main" tabIndex={-1}>
        {online === false && (
          <div className="banner banner--error" role="alert">
            ULTRON's service isn't responding. If you closed the ULTRON window or launcher, start it again. Retrying every 5 seconds…
          </div>
        )}
        {view === "home" && <HomeView status={status} core={effectiveCore} onAsk={(q) => { setChatSeed(q); go("chat"); }} onNavigate={go} />}
        {view === "chat" && <ChatView onCoreState={setCoreState} core={effectiveCore} seed={chatSeed} clearSeed={() => setChatSeed(null)} status={status} onChanged={refreshStatus} />}
        {view === "memory" && <MemoryView />}
        {view === "activity" && <ActivityView />}
        {view === "settings" && <SettingsView prefs={prefs} setPrefs={setPrefs} onSaved={refreshStatus} />}
      </main>
    </div>
  );
}

function ConnectionPill({ online, status }: { online: boolean | null; status: Status | null }) {
  const label = online === null ? "Connecting…" : online ? "Online" : "Offline";
  return (
    <div className={`pill ${online ? "pill--ok" : online === false ? "pill--bad" : ""}`} role="status" aria-live="polite">
      <span className="pill__dot" aria-hidden="true" />
      <span>
        {label}
        {online && status && <small> · {status.provider === "mock" ? "mock model" : status.model}</small>}
      </span>
    </div>
  );
}
