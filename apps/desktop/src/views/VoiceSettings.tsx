import { useEffect, useRef, useState } from "react";
import type { VoiceStatus } from "@ultron/schemas";
import { api } from "../api.ts";
import { listMicrophones, MicError, Recorder } from "../voice/recorder.ts";
import { loadVoicePrefs, saveVoicePrefs, type VoicePrefs } from "../voice/prefs.ts";

const ENGINES = [
  { id: "local", name: "On this PC (Whisper) — recommended", help: "Free and private: your voice never leaves this computer. The first use downloads a speech model once (about 150–300 MB)." },
  { id: "openai", name: "OpenAI (cloud)", help: "Uses your OpenAI API key; audio is sent to OpenAI. Enter the transcription model name from OpenAI's docs." },
  { id: "mock", name: "Test engine", help: "For testing only: measures your audio but doesn't recognize words." },
] as const;

export function VoiceSettings({ onSaved }: { onSaved: () => void }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [engine, setEngine] = useState<VoiceStatus["engine"]>("local");
  const [model, setModel] = useState("");
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [micMsg, setMicMsg] = useState<string | null>(null);
  const tester = useRef(new Recorder());

  const refresh = async () => {
    const s = await api.voiceStatus();
    setStatus(s);
    return s;
  };

  useEffect(() => {
    refresh().then((s) => {
      setEngine(s.engine);
      setModel(s.engine === "local" && s.model === "Xenova/whisper-base.en" ? "" : s.model);
    }).catch(() => {});
    const loadMics = () => listMicrophones().then(setMics).catch(() => {});
    loadMics();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadMics);
    const t = tester.current;
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", loadMics);
      t.cancel();
    };
  }, []);

  // Poll while a model download/load is in progress.
  useEffect(() => {
    if (status?.state !== "loading") return;
    const t = setInterval(() => refresh().catch(() => {}), 1000);
    return () => clearInterval(t);
  }, [status?.state]);

  useEffect(() => {
    if (!testing) return;
    let raf = 0;
    const tick = () => {
      setLevel(tester.current.level());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [testing]);

  const updatePrefs = (p: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    saveVoicePrefs(next);
  };

  const saveEngine = async () => {
    setStatus(await api.saveVoiceSettings({ engine, model: model.trim() || undefined }));
    onSaved();
  };

  const toggleTest = async () => {
    setMicMsg(null);
    if (testing) {
      tester.current.cancel();
      setTesting(false);
      setLevel(0);
      return;
    }
    try {
      await tester.current.start(prefs.micId || undefined);
      setTesting(true);
      setMics(await listMicrophones()); // device names become visible once permission is granted
    } catch (err) {
      setMicMsg(err instanceof MicError ? err.message : String(err));
    }
  };

  const info = ENGINES.find((e) => e.id === engine)!;
  const stateLabel: Record<VoiceStatus["state"], string> = {
    ready: "Ready",
    not_loaded: "Not downloaded yet",
    loading: "Loading…",
    error: "Problem",
    not_configured: "Needs setup",
  };

  return (
    <section className="panel form" aria-labelledby="voice-title">
      <h2 className="panel__title" id="voice-title">Voice</h2>
      <p className="muted small">
        Push-to-talk: in Chat, hold the 🎙 Talk button (or hold Space) while you speak and let go to send. The microphone is only on while you hold it, and a red
        "Listening" bar is always shown. Recordings are never saved, only the text.
      </p>

      <fieldset className="radios">
        <legend className="sr-only">Speech recognition engine</legend>
        {ENGINES.map((e) => (
          <label key={e.id} className={`radio ${engine === e.id ? "is-checked" : ""}`}>
            <input type="radio" name="stt" value={e.id} checked={engine === e.id} onChange={() => setEngine(e.id)} />
            <span>{e.name}</span>
          </label>
        ))}
      </fieldset>
      <p className="muted small">{info.help}</p>
      {engine !== "mock" && (
        <label className="field">
          <span>Model {engine === "local" ? "(leave blank for Xenova/whisper-base.en; Xenova/whisper-small.en is more accurate but slower)" : "(required)"}</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={engine === "local" ? "Xenova/whisper-base.en" : "transcription model name"} />
        </label>
      )}
      <div className="row">
        <button className="btn btn--primary" type="button" onClick={saveEngine}>Save voice engine</button>
        {status?.engine === "local" && status.state !== "ready" && (
          <button className="btn" type="button" disabled={status.state === "loading"} onClick={async () => setStatus(await api.prepareVoice())}>
            {status.state === "loading" ? "Downloading…" : "Download speech model now"}
          </button>
        )}
      </div>
      {status && (
        <div className={`banner ${status.state === "ready" ? "banner--ok" : status.state === "error" || status.state === "not_configured" ? "banner--error" : ""}`} role="status">
          <strong>{stateLabel[status.state]}</strong> · {status.engine} / {status.model}. {status.detail}
          {status.state === "loading" && status.progress !== undefined && (
            <div className="progress" aria-label={`Download ${status.progress}%`}><i style={{ width: `${status.progress}%` }} /></div>
          )}
          <div className="small muted">{status.privacy}</div>
        </div>
      )}

      <label className="field">
        <span>Microphone</span>
        <select value={prefs.micId} onChange={(e) => updatePrefs({ micId: e.target.value })}>
          <option value="">System default</option>
          {mics.filter((m) => m.deviceId && m.deviceId !== "default").map((m, i) => (
            <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1} (names appear after you allow access)`}</option>
          ))}
        </select>
      </label>
      <div className="row">
        <button className={`btn ${testing ? "mic--on" : ""}`} type="button" onClick={toggleTest}>{testing ? "■ Stop test" : "🎙 Test microphone"}</button>
        <div className="meter" style={{ flex: 1, maxWidth: 320 }} aria-label="Microphone level"><i style={{ transform: `scaleX(${Math.max(0.01, level)})` }} /></div>
      </div>
      {testing && <p className="muted small">Speak normally. The bar should move. Nothing is recorded or sent during this test.</p>}
      {micMsg && <div className="banner banner--error" role="alert">{micMsg}</div>}

      <label className="toggle">
        <input type="checkbox" checked={prefs.autoSend} onChange={(e) => updatePrefs({ autoSend: e.target.checked })} />
        <span>Send right after I stop talking (turn off to review and edit the transcript first)</span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={prefs.conversation} onChange={(e) => updatePrefs({ conversation: e.target.checked })} />
        <span>Conversation mode: in hands-free, after ULTRON answers, keep listening so I can just reply (no "Ultron" needed). Say "that's all" to stop.</span>
      </label>
      <RoomToggle />
      <label className="toggle">
        <input type="checkbox" checked={prefs.bargeIn} onChange={(e) => updatePrefs({ bargeIn: e.target.checked })} />
        <span>Interrupt by voice (experimental): in hands-free, talking over ULTRON stops it and it listens to you. Works best with headphones; with loud speakers it may interrupt itself.</span>
      </label>
    </section>
  );
}

/** Room awareness: hands-free remembers the last few minutes it overheard (in memory only), for "what do you think?". */
function RoomToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    api.room().then((r) => setOn(r.enabled)).catch(() => {});
  }, []);
  if (on === null) return null;
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={async (e) => setOn((await api.setRoom(e.target.checked)).enabled)} />
      <span>
        Room awareness (experimental): in hands-free, ULTRON keeps the last 3 minutes of conversation around it in memory (never saved, cleared
        when hands-free stops) so you can say "Ultron, what do you think?". Only used with a local brain.
      </span>
    </label>
  );
}

