import { useEffect, useState } from "react";
import { api, type WatchedPage } from "../api.ts";

/** Pages ULTRON is keeping an eye on ("tell me when … changes / says …"). */
export function WatchersPanel({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<WatchedPage[]>([]);
  const load = () => api.watchers().then((r) => setItems(r.watchers)).catch(() => {});
  useEffect(() => {
    load();
  }, [refreshKey]);
  if (!items.length) return null;
  return (
    <section className="panel" aria-labelledby="watch-title">
      <h2 className="panel__title" id="watch-title">Watching</h2>
      <ul className="todos">
        {items.map((w) => (
          <li key={w.id} className="todo">
            <span style={{ flex: 1 }}>
              👁 <strong>{w.label}</strong> · {w.lookFor ? `waiting for "${w.lookFor}"` : "any change"} · every {w.everyMinutes} min
              <span className="muted small"> {w.lastError ? `(couldn't check: ${w.lastError})` : w.lastCheckedAt ? `(checked ${new Date(w.lastCheckedAt).toLocaleTimeString()})` : "(not checked yet)"}</span>
            </span>
            <button type="button" className="btn btn--small" onClick={async () => { await api.stopWatcher(w.id); load(); }}>Stop</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
