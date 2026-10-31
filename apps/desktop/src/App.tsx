import { useCallback, useEffect, useRef, useState } from "react";
import { api, health, subscribeEvents, type Status } from "./api.ts";
import { RemindersView } from "./views/Reminders.tsx";
import { FilesView } from "./views/Files.tsx";
import { ConnectionsView } from "./views/Connections.tsx";
import { Toasts, type Toast } from "./Toasts.tsx";
import { Speaker } from "./voice/speaker.ts";
import { loadVoicePrefs } from "./voice/prefs.ts";
import type { CoreState } from "./Core.tsx";
import { useUiPrefs } from "./prefs.ts";
import { HomeView } from "./views/Home.tsx";
import { ChatView } from "./views/Chat.tsx";
import { MemoryView } from "./views/Memory.tsx";
import { ActivityView } from "./views/Activity.tsx";
import { SettingsView } from "./views/Settings.tsx";
import { PairScreen } from "./views/Pair.tsx";

export type View = "home" | "chat" | "reminders" | "files" | "connections" | "memory" | "activity" | "settings";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "◎" },
  { id: "chat", label: "Chat", icon: "✦" },
  { id: "reminders", label: "Reminders", icon: "⏰" },
  { id: "files", label: "Files", icon: "📁" },
  { id: "connections", label: "Connections", icon: "⛓" },
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
  const [talkNow, setTalkNow] = useState(false);
  const [needPair, setNeedPair] = useState(false);
  useEffect(() => {
    const ask = (e: Event) => {
      setChatSeed((e as CustomEvent<string>).detail);
      setView("chat");
    };
    const talk = () => {
      setTalkNow(true);
      setView("chat");
    };
    window.addEventListener("ultron-ask", ask);
    window.addEventListener("ultron-talk", talk);
    return () => {
      window.removeEventListener("ultron-ask", ask);
      window.removeEventListener("ultron-talk", talk);
    };
  }, []);
  useEffect(() => {
    const on = () => setNeedPair(true);
    window.addEventListener("ultron-pair-required", on);
    return () => window.removeEventListener("ultron-pair-required", on);
  }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [remindersKey, setRemindersKey] = useState(0);
  const speaker = useRef<Speaker | null>(null);

  // Live events: reminders pop up (and are spoken), approvals update everywhere.
  useEffect(() => {
    const toast = (t: Omit<Toast, "id">) => setToasts((cur) => [...cur, { ...t, id: crypto.randomUUID() }]);
    return subscribeEvents((e) => {
      if (e.type === "reminder_fired") {
        toast({ kind: "reminder", title: "⏰ Reminder", body: e.reminder.text });
        setRemindersKey((k) => k + 1);
        if ("Notification" in window && Notification.permission === "granted") new Notification("ULTRON reminder", { body: e.reminder.text, icon: "/ultron.svg" });
        if (loadVoicePrefs().speakMode !== "never") {
          api.ttsStatus()
            .then((s) => {
              speaker.current?.stop();
              const sp = new Speaker(() => s.engine, () => loadVoicePrefs().browserVoice, () => s.speed);
              sp.unlock();
              sp.enqueue([`Reminder: ${e.reminder.text}`]);
              speaker.current = sp;
            })
            .catch(() => {});
        }
      } else if (e.type === "reminders_missed") {
        toast({ kind: "warn", title: "Missed while ULTRON was off", body: e.reminders.map((r) => r.text).join(", ") });
        setRemindersKey((k) => k + 1);
      } else if (e.type === "checkin") {
        // ULTRON reaching out first: a morning summary with a button for the full briefing.
        toast(
          e.kind === "evening"
            ? { kind: "info", title: `🌙 ${e.title}`, body: e.body, action: { label: "Talk", run: () => window.dispatchEvent(new Event("ultron-talk")) } }
            : { kind: "info", title: `☀ ${e.title}`, body: e.body, action: { label: "Brief me", run: () => window.dispatchEvent(new CustomEvent("ultron-ask", { detail: "Good morning, brief me" })) } },
        );
        if ("Notification" in window && Notification.permission === "granted") new Notification(`ULTRON: ${e.title}`, { body: e.body, icon: "/ultron.svg" });
      } else if (e.type === "connector_synced") {
        window.dispatchEvent(new CustomEvent("ultron-connector", { detail: e }));
      } else if (e.type === "action_updated") {
        window.dispatchEvent(new CustomEvent("ultron-action", { detail: e.execution }));
        refreshStatus();
      }
    });
  }, []);

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

  // Each kind of brain gets its own skin: local = Ultron red, cloud = amber, test = violet.
  useEffect(() => {
    if (status) document.documentElement.dataset.brain = status.where;
  }, [status?.where]);

  const go = (v: View) => setView(v);
  const effectiveCore: CoreState = online === false ? "offline" : coreState;

  if (needPair) return <PairScreen />;

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
            {n.id === "activity" && (status?.pendingApprovals ?? 0) > 0 && <span className="badge" title="Actions waiting for your approval">{status!.pendingApprovals}</span>}
            {n.id === "reminders" && (status?.upcomingReminders ?? 0) > 0 && <span className="badge badge--soft">{status!.upcomingReminders}</span>}
          </button>
        ))}
        <div className="nav__footer">
          <ConnectionPill online={online} status={status} />
          <button className="btn btn--danger btn--block" onClick={() => { speaker.current?.stop(); api.stopAll().then(refreshStatus).catch(() => {}); }} title="Stop every reply, voice and pending action immediately">
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
        {view === "home" && <HomeView status={status} core={effectiveCore} onAsk={(q) => { setChatSeed(q); go("chat"); }} onTalk={() => { setTalkNow(true); go("chat"); }} onNavigate={go} />}
        {view === "chat" && <ChatView onCoreState={setCoreState} core={effectiveCore} seed={chatSeed} clearSeed={() => setChatSeed(null)} talk={talkNow} clearTalk={() => setTalkNow(false)} status={status} onChanged={refreshStatus} />}
        {view === "reminders" && <RemindersView refreshKey={remindersKey} />}
        {view === "files" && <FilesView />}
        {view === "connections" && <ConnectionsView onAsk={(q) => { setChatSeed(q); go("chat"); }} />}
        {view === "memory" && <MemoryView />}
        {view === "activity" && <ActivityView />}
        {view === "settings" && <SettingsView prefs={prefs} setPrefs={setPrefs} onSaved={refreshStatus} />}
      </main>
      <Toasts toasts={toasts} dismiss={(id) => setToasts((cur) => cur.filter((t) => t.id !== id))} />
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
        {online && status && <small> · {status.where === "test" ? "test brain" : `${status.where === "local" ? "local" : "cloud"} · ${status.model}`}</small>}
      </span>
    </div>
  );
}
