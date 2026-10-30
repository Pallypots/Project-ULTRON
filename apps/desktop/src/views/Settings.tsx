import { useEffect, useRef, useState } from "react";
import { api, type ProviderSettings } from "../api.ts";
import type { UiPrefs } from "../prefs.ts";
import { VoiceSettings } from "./VoiceSettings.tsx";
import { LocalAiPanel } from "./LocalAiPanel.tsx";
import { SpeechSettings } from "./SpeechSettings.tsx";
import { PersonaSettings } from "./PersonaSettings.tsx";

const PROVIDERS = [
  { id: "ollama", name: "Local AI on this PC (Ollama), recommended", help: "Free, private and works offline: the AI runs entirely on this computer. Set it up below." },
  { id: "mock", name: "Built-in mock (offline)", help: "No account needed. Great for trying ULTRON; replies are canned." },
  { id: "anthropic", name: "Claude (Anthropic API)", help: "Needs an Anthropic API key from console.anthropic.com → API Keys. Note: a Claude.ai subscription does not include API usage; API calls are billed separately." },
  { id: "openai", name: "OpenAI or local model (OpenAI-compatible)", help: "For OpenAI, use a key from platform.openai.com. For a local model (Ollama, LM Studio), set the server URL, e.g. http://localhost:11434/v1, and the model name you installed. A ChatGPT subscription does not include API usage." },
] as const;

export function SettingsView({ prefs, setPrefs, onSaved }: { prefs: UiPrefs; setPrefs: (p: Partial<UiPrefs>) => void; onSaved: () => void }) {
  const [current, setCurrent] = useState<ProviderSettings | null>(null);
  const [provider, setProvider] = useState<ProviderSettings["provider"]>("mock");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const touched = useRef(false);
  const load = async () => {
    const s = await api.providerSettings();
    setCurrent(s);
    // Don't overwrite a choice the owner already made while this was loading.
    if (touched.current) return;
    setProvider(s.provider);
    setModel(s.model);
    setBaseUrl(s.baseUrl);
  };
  useEffect(() => {
    load().catch(() => {});
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api.saveProviderSettings({ provider, model: model.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined });
      setApiKey("");
      touched.current = false;
      await load();
      onSaved();
      setMsg(r.ok ? { ok: true, text: "Saved. Use “Test connection” to confirm it works." } : { ok: false, text: r.problem ?? "Saved, but not ready yet." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const r = await api.testProvider();
      setMsg({ ok: r.ok, text: r.message });
    } finally {
      setTesting(false);
    }
  };

  const info = PROVIDERS.find((p) => p.id === provider)!;
  const keyName = provider === "anthropic" ? "anthropic" : provider === "openai" ? "openai" : null;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Choose ULTRON's brain and how it looks. Local AI keeps everything on this computer. Cloud brains are optional; their API keys stay on this computer and are never shown again after saving.</p>
        </div>
      </header>

      <form className="panel form" onSubmit={save}>
        <h2 className="panel__title">Language model (ULTRON's brain)</h2>
        <p className="muted small">Tip: you can also switch by voice or chat, e.g. "switch your brain to local" or "switch to Fable".</p>
        <fieldset className="radios">
          <legend className="sr-only">Provider</legend>
          {PROVIDERS.map((p) => (
            <label key={p.id} className={`radio ${provider === p.id ? "is-checked" : ""}`}>
              <input type="radio" name="provider" value={p.id} checked={provider === p.id} onChange={() => { touched.current = true; setProvider(p.id); }} />
              <span>{p.name}</span>
            </label>
          ))}
        </fieldset>
        <p className="muted small">{info.help}</p>

        {provider === "ollama" && <LocalAiPanel onChanged={() => { api.providerSettings().then(setCurrent).catch(() => {}); onSaved(); }} />}
        {provider !== "mock" && provider !== "ollama" && (
          <>
            <label className="field">
              <span>Model {provider === "anthropic" ? "(leave blank for the default: claude-opus-5-5)" : "(required, e.g. the exact model name from your provider)"}</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === "anthropic" ? "claude-opus-5-5" : "model name"} />
            </label>
            <label className="field">
              <span>Server URL (optional{provider === "openai" ? "; required for local models" : ""})</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider === "openai" ? "http://localhost:11434/v1" : "default"} />
            </label>
            <label className="field">
              <span>API key {keyName && current?.keys[keyName] ? "(a key is saved; type a new one to replace it)" : ""}</span>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder={keyName && current?.keys[keyName] ? "••••••••  saved" : "paste your API key"} />
            </label>
          </>
        )}
        <div className="row" hidden={provider === "ollama"}>
          <button className="btn btn--primary" type="submit">Save</button>
          <button className="btn" type="button" onClick={test} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
          {keyName && current?.keys[keyName] && (
            <button className="btn btn--danger" type="button" onClick={async () => { await api.removeKey(keyName); await load(); onSaved(); setMsg({ ok: true, text: "API key removed." }); }}>Remove saved key</button>
          )}
        </div>
        {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
        <p className="muted small">Cost note: real models are billed by your provider per use. ULTRON limits each reply's length and how much history it sends, and you can stop any reply with Esc or the Stop button.</p>
      </form>

      <VoiceSettings onSaved={onSaved} />
      <SpeechSettings />

      <ActionsSettings />
      <WindowsSettings />

      <section className="panel form">
        <h2 className="panel__title">Display &amp; accessibility</h2>
        <label className="toggle">
          <input type="checkbox" checked={prefs.highContrast} onChange={(e) => setPrefs({ highContrast: e.target.checked })} />
          <span>High contrast</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={prefs.reducedMotion} onChange={(e) => setPrefs({ reducedMotion: e.target.checked })} />
          <span>Reduce motion (stops HUD animations)</span>
        </label>
      </section>

      <PersonaSettings onSaved={onSaved} />
    </div>
  );
}

function ActionsSettings() {
  const [policy, setPolicy] = useState<{ paused: boolean; confirmLowRisk: boolean } | null>(null);
  const [notify, setNotify] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  useEffect(() => {
    api.actions().then((r) => setPolicy(r.policy)).catch(() => {});
  }, []);
  if (!policy) return null;
  const save = async (p: { paused: boolean; confirmLowRisk: boolean }) => setPolicy((await api.saveActionPolicy(p)).policy);
  return (
    <section className="panel form" aria-labelledby="actions-title">
      <h2 className="panel__title" id="actions-title">Actions</h2>
      <p className="muted small">
        What ULTRON may do on its own: read-only things (like checking the time) always; low-risk, undoable things (like setting a reminder) unless you
        turn that off below; anything with an outside effect (like opening a website) only after you click Approve. Spoken "yes" never approves anything.
      </p>
      <label className="toggle">
        <input type="checkbox" checked={policy.paused} onChange={(e) => save({ ...policy, paused: e.target.checked })} />
        <span><strong>Pause all actions</strong> (kill switch: only read-only lookups still work)</span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={policy.confirmLowRisk} onChange={(e) => save({ ...policy, confirmLowRisk: e.target.checked })} />
        <span>Ask me before low-risk actions too (e.g. setting reminders)</span>
      </label>
      <div className="row">
        <span className="small muted">Windows notifications for reminders: {notify === "granted" ? "on" : notify === "denied" ? "blocked in browser settings" : notify === "unsupported" ? "not supported" : "off"}</span>
        {notify === "default" && <button type="button" className="btn btn--small" onClick={() => Notification.requestPermission().then(setNotify)}>Turn on</button>}
      </div>
    </section>
  );
}

function WindowsSettings() {
  const [s, setS] = useState<{ supported: boolean; startAtLogin: boolean; desktopShortcut: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api.shortcuts().then(setS).catch(() => {});
  }, []);
  if (!s?.supported) return null;
  const run = async (fn: () => Promise<{ supported: boolean; startAtLogin: boolean; desktopShortcut: boolean }>, ok: string) => {
    try {
      setS(await fn());
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <section className="panel form" aria-labelledby="win-title">
      <h2 className="panel__title" id="win-title">Windows</h2>
      <label className="toggle">
        <input type="checkbox" checked={s.startAtLogin} onChange={(e) => run(() => api.setStartAtLogin(e.target.checked), e.target.checked ? "ULTRON will start quietly when you sign in to Windows." : "ULTRON won't start at sign-in anymore.")} />
        <span>Start ULTRON when I sign in to Windows (runs in the background; reminders keep working)</span>
      </label>
      <div className="row">
        <button type="button" className="btn" onClick={() => run(() => api.createDesktopShortcut(), "Desktop shortcut created: look for the ULTRON icon.")}>
          {s.desktopShortcut ? "Recreate desktop shortcut" : "Add ULTRON icon to the desktop"}
        </button>
      </div>
      {msg && <p className="small muted" role="status">{msg}</p>}
    </section>
  );
}
