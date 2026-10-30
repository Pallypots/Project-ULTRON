import { useCallback, useEffect, useState } from "react";
import { api, type LocalAiStatus } from "../api.ts";

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** One-click local brain setup: detect Ollama, show hardware, download the recommended model, switch to it. */
export function LocalAiPanel({ onChanged }: { onChanged: () => void }) {
  const [s, setS] = useState<LocalAiStatus | null>(null);
  const [custom, setCustom] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      setS(await api.localAiStatus());
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const downloading = s?.pulls.some((p) => p.status === "downloading");
  useEffect(() => {
    // One more refresh after a download finishes so the new model shows as installed.
    if (!downloading) {
      const t = setTimeout(() => api.localAiStatus().then(setS).catch(() => {}), 600);
      return () => clearTimeout(t);
    }
    const t = setInterval(() => api.localAiStatus().then(setS).catch(() => {}), 1000);
    return () => clearInterval(t);
  }, [downloading]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ ok: true, text: ok });
      await load();
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  if (!s) return <p className="muted">Checking for local AI…</p>;

  const installed = new Set(s.models.map((m) => m.name));
  const rec = s.recommendation.primary;
  const hw = s.hardware;

  return (
    <div className="local-ai">
      <div className={`banner ${s.ollama.running ? "banner--ok" : "banner--warn"}`} role="status">
        {s.ollama.running ? (
          <>
            <strong>Local AI engine running</strong> (Ollama {s.ollama.version}). Models run on this computer; nothing is sent to the cloud.
          </>
        ) : (
          <>
            <strong>Step 1: install the free local AI engine.</strong> Download and run the installer from{" "}
            <a href="https://ollama.com/download" target="_blank" rel="noreferrer">ollama.com/download</a> (Windows). It starts automatically afterwards. Then click{" "}
            <em>Check again</em>.
          </>
        )}{" "}
        <button type="button" className="link" onClick={() => load()} disabled={checking}>{checking ? "Checking…" : "Check again"}</button>
      </div>

      <p className="small muted">
        <strong>This computer:</strong>{" "}
        {hw.usableGpu ? `${hw.usableGpu.name} (${hw.usableGpu.vramGb} GB graphics memory)` : "no graphics card the local engine can use, so the AI will run on the processor"} ·{" "}
        {hw.ramGb} GB RAM · {hw.cpuThreads} CPU threads. {s.recommendation.summary}
      </p>

      <div className="rec">
        <div>
          <div className="eyebrow">Recommended for this PC</div>
          <strong>{rec.label}</strong> <code>{rec.model}</code>
          <div className="small muted">{rec.why} Download ≈ {rec.approxDownloadGb} GB, one time.</div>
        </div>
        {installed.has(rec.model) ? (
          s.active === rec.model ? (
            <span className="tag tag--accent">Active</span>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => act(() => api.useLocalModel(rec.model), `Now using ${rec.model} locally.`)}>Use this brain</button>
          )
        ) : (
          <button type="button" className="btn btn--primary" disabled={!s.ollama.running || downloading} onClick={() => act(() => api.pullLocalModel(rec.model))}>
            Download ({rec.approxDownloadGb} GB)
          </button>
        )}
      </div>

      {s.pulls.map((p) => (
        <div key={p.model} className="pull" role="status">
          <div className="row">
            <code>{p.model}</code>
            <span className="small">{p.detail}</span>
            {p.totalBytes > 0 && p.status === "downloading" && <span className="small muted">{gb(p.completedBytes)} of {gb(p.totalBytes)}</span>}
            {p.status === "downloading" && <button type="button" className="btn btn--small" onClick={() => act(() => api.cancelLocalPull(p.model))}>Cancel</button>}
            {p.status === "success" && !s.active?.startsWith(p.model) && installed.has(p.model) && (
              <button type="button" className="btn btn--small btn--primary" onClick={() => act(() => api.useLocalModel(p.model), `Now using ${p.model} locally.`)}>Use it</button>
            )}
          </div>
          {p.status === "downloading" && (
            <div className="progress" aria-label={`Downloading ${p.model}`}><i style={{ width: `${p.totalBytes ? (100 * p.completedBytes) / p.totalBytes : 2}%` }} /></div>
          )}
        </div>
      ))}

      {s.models.length > 0 && (
        <>
          <div className="eyebrow">Downloaded local models</div>
          <ul className="models">
            {s.models.map((m) => (
              <li key={m.name}>
                <code>{m.name}</code>
                <span className="small muted">{m.parameterSize ?? ""} · {gb(m.sizeBytes)}</span>
                {s.active === m.name ? (
                  <span className="tag tag--accent">Active</span>
                ) : (
                  <button type="button" className="btn btn--small" onClick={() => act(() => api.useLocalModel(m.name), `Now using ${m.name} locally.`)}>Use</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Not a <form>: this panel sits inside the Settings form, and nested forms submit the outer one. */}
      <div className="row">
        <label htmlFor="custom-model" className="sr-only">Other model name</label>
        <input
          id="custom-model"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (custom.trim()) act(() => api.pullLocalModel(custom.trim())); } }}
          placeholder="Other model from ollama.com/library, e.g. qwen3:8b"
          style={{ flex: 1 }}
        />
        <button className="btn" type="button" disabled={!s.ollama.running || !custom.trim()} onClick={() => act(() => api.pullLocalModel(custom.trim()))}>Download</button>
      </div>
      {s.recommendation.alternatives.length > 0 && (
        <p className="small muted">Also suitable: {s.recommendation.alternatives.map((a) => `${a.model} (${a.approxDownloadGb} GB)`).join(" · ")}</p>
      )}
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}
    </div>
  );
}
