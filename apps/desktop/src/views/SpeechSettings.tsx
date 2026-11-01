import { useEffect, useRef, useState } from "react";
import type { TtsStatusResponse } from "@ultron/schemas";
import { api } from "../api.ts";
import { Speaker } from "../voice/speaker.ts";
import { loadVoicePrefs, saveVoicePrefs, type VoicePrefs } from "../voice/prefs.ts";

const ENGINES = [
  { id: "local", name: "Natural voice on this PC (Kokoro), recommended", help: "Runs on this computer. Downloads about 165 MB the first time, then works offline." },
  { id: "browser", name: "Windows built-in voices", help: "No download; more robotic. Only voices installed on this computer are offered (online voices are hidden for privacy)." },
  { id: "mock", name: "Test tone", help: "For testing only." },
] as const;

const SAMPLE = "Good evening. All systems are running locally, and I'm ready when you are.";

export function SpeechSettings() {
  const [s, setS] = useState<TtsStatusResponse | null>(null);
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const speaker = useRef<Speaker | null>(null);

  const refresh = async () => setS(await api.ttsStatus());
  useEffect(() => {
    refresh().catch(() => {});
    const loadVoices = () => setSystemVoices(("speechSynthesis" in window ? speechSynthesis.getVoices() : []).filter((v) => v.localService));
    loadVoices();
    if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      if ("speechSynthesis" in window) speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      speaker.current?.stop();
    };
  }, []);
  useEffect(() => {
    if (s?.state !== "loading") return;
    const t = setInterval(() => refresh().catch(() => {}), 1000);
    return () => clearInterval(t);
  }, [s?.state]);

  const save = async (patch: { engine?: TtsStatusResponse["engine"]; voice?: string; speed?: number }) => {
    if (!s) return;
    setS(await api.saveTtsSettings({ engine: patch.engine ?? s.engine, voice: patch.voice ?? s.voice, speed: patch.speed ?? s.speed }));
  };
  const updatePrefs = (p: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    saveVoicePrefs(next);
  };

  const preview = () => {
    if (!s) return;
    setMsg(null);
    speaker.current?.stop();
    const sp = new Speaker(() => s.engine, () => prefs.browserVoice, () => s.speed);
    sp.onChange = setPreviewing;
    sp.onError = setMsg;
    sp.unlock();
    sp.enqueue([SAMPLE]);
    speaker.current = sp;
  };

  if (!s) return null;
  const info = ENGINES.find((e) => e.id === s.engine)!;
  return (
    <section className="panel form" aria-labelledby="speech-title">
      <h2 className="panel__title" id="speech-title">Spoken replies</h2>
      <fieldset className="radios">
        <legend className="sr-only">Read replies aloud</legend>
        {(
          [
            ["voice", "When I talk to ULTRON (recommended)"],
            ["always", "Always"],
            ["never", "Never"],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className={`radio ${prefs.speakMode === id ? "is-checked" : ""}`}>
            <input type="radio" name="speakMode" checked={prefs.speakMode === id} onChange={() => updatePrefs({ speakMode: id })} />
            <span>Read replies aloud: {label}</span>
          </label>
        ))}
      </fieldset>
      <p className="muted small">Interrupt anytime: press Talk (or hold Space), press Esc, or click Stop speaking. Spoken audio is never saved.</p>

      <fieldset className="radios">
        <legend className="sr-only">Voice engine</legend>
        {ENGINES.map((e) => (
          <label key={e.id} className={`radio ${s.engine === e.id ? "is-checked" : ""}`}>
            <input type="radio" name="ttsEngine" checked={s.engine === e.id} onChange={() => save({ engine: e.id })} />
            <span>{e.name}</span>
          </label>
        ))}
      </fieldset>
      <p className="muted small">{info.help}</p>

      {s.engine === "local" && (
        <label className="field">
          <span>Voice</span>
          <select value={s.voice} onChange={(e) => save({ voice: e.target.value })}>
            {s.voices.map((v) => (
              <option key={v.id} value={v.id}>{v.name} · {v.accent} {v.gender.toLowerCase()} · quality {v.quality}</option>
            ))}
          </select>
        </label>
      )}
      {s.engine === "browser" && (
        <label className="field">
          <span>System voice</span>
          <select value={prefs.browserVoice} onChange={(e) => updatePrefs({ browserVoice: e.target.value })}>
            <option value="">Default</option>
            {systemVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
          </select>
        </label>
      )}
      <label className="field">
        <span>Speaking speed: {s.speed.toFixed(2)}×</span>
        <input type="range" min={0.7} max={1.4} step={0.05} value={s.speed} onChange={(e) => setS({ ...s, speed: Number(e.target.value) })} onMouseUp={() => save({ speed: s.speed })} onKeyUp={() => save({ speed: s.speed })} onTouchEnd={() => save({ speed: s.speed })} />
      </label>
      {s.engine !== "browser" && (
        <label className="toggle">
          <input type="checkbox" checked={prefs.ultronEffect} onChange={(e) => updatePrefs({ ultronEffect: e.target.checked })} />
          <span>Ultron voice effect: a little deeper with a faint metallic edge (preview it to hear)</span>
        </label>
      )}
      {s.engine !== "browser" && (
        <label className="toggle">
          <input type="checkbox" checked={prefs.councilEffect} onChange={(e) => updatePrefs({ councilEffect: e.target.checked })} />
          <span>Use the Ultron voice effect in Council mode</span>
        </label>
      )}

      <div className="row">
        <button type="button" className="btn btn--primary" onClick={previewing ? () => speaker.current?.stop() : preview}>{previewing ? "■ Stop" : "▶ Preview voice"}</button>
        {s.engine === "local" && s.state !== "ready" && (
          <button type="button" className="btn" disabled={s.state === "loading"} onClick={async () => setS(await api.prepareTts())}>
            {s.state === "loading" ? "Downloading…" : "Download voice now"}
          </button>
        )}
      </div>
      {s.engine === "local" && (
        <div className={`banner ${s.state === "ready" ? "banner--ok" : s.state === "error" ? "banner--error" : ""}`} role="status">
          {s.state === "ready" ? "Voice ready." : s.state === "loading" ? "Preparing the voice…" : s.state === "error" ? "Problem: " : "Not downloaded yet. "} {s.state !== "ready" && s.detail}
          {s.state === "loading" && s.progress !== undefined && <div className="progress"><i style={{ width: `${s.progress}%` }} /></div>}
        </div>
      )}
      {msg && <div className="banner banner--error" role="alert">{msg}</div>}
    </section>
  );
}
