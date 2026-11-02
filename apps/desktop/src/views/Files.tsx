import { useEffect, useState } from "react";
import { Icon, type IconName } from "../icons.tsx";
import { api, type FileHit, type FolderInfo } from "../api.ts";

const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);

export function FilesView() {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FileHit[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api.folders().then((r) => setFolders(r.folders)).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  const indexing = folders.some((f) => f.status === "indexing" || f.status === "pending");
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [indexing]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api.addFolder(path.trim());
      setPath("");
      setMsg({ ok: true, text: "Folder added. Indexing has started; it can take a minute for big folders." });
      load();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) setHits((await api.searchFiles(query.trim())).results);
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Files</h1>
          <p className="muted">
            Folders you add here become ULTRON's "second brain": it can search and read them to answer questions ("what's the latest on my game port?"). It can't
            see anything else. The index stays on this computer. Secrets (.env, keys, password files), hidden folders and system folders are always skipped.
            ULTRON asks before opening anything on screen.
          </p>
        </div>
      </header>

      <form className="panel add-memory" onSubmit={add}>
        <label htmlFor="folder-path" className="sr-only">Folder path</label>
        <input id="folder-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Folder path, e.g. C:\Users\you\Documents\Projects (tip: copy it from File Explorer's address bar)" required />
        <button className="btn btn--primary" type="submit">Add folder</button>
      </form>
      {msg && <div className={`banner ${msg.ok ? "banner--ok" : "banner--error"}`} role="status">{msg.text}</div>}

      <section className="panel">
        <h2 className="panel__title">Approved folders</h2>
        {folders.length === 0 ? (
          <p className="empty">No folders yet. ULTRON can't see any of your files.</p>
        ) : (
          <ul className="reminders">
            {folders.map((f) => (
              <li key={f.id} className={`reminder folder folder--${f.status}`}>
                <span className="mono"><Icon name="folder" /> {f.path}</span>
                <span className="muted small"><Icon name={f.status === "ready" ? "check" : f.status === "error" ? "warning" : "pending"} /> {f.detail || (f.status === "ready" || f.status === "error" ? "" : "Waiting…")}</span>
                <span className="row">
                  <button type="button" className="btn btn--small" disabled={f.status === "indexing"} onClick={() => api.reindexFolder(f.id).then(load)}>Re-scan</button>
                  <button type="button" className="btn btn--small btn--danger" onClick={() => { if (confirm(`Stop ULTRON seeing ${f.path}? Its index will be deleted (your files are untouched).`)) api.removeFolder(f.id).then(load); }}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="panel add-memory" onSubmit={search}>
        <label htmlFor="file-q" className="sr-only">Search files</label>
        <input id="file-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your approved folders…" />
        <button className="btn" type="submit">Search</button>
      </form>
      {hits && (
        <section className="panel">
          <h2 className="panel__title">{hits.length ? `${hits.length} result${hits.length > 1 ? "s" : ""}` : "No matches"}</h2>
          <ul className="reminders">
            {hits.map((h) => (
              <li key={h.docId} className="reminder file-hit">
                <span>
                  <strong>{h.name}</strong>
                  <div className="mono small muted">{h.path}</div>
                  {h.snippet && <div className="small">{h.snippet}</div>}
                </span>
                <span className="muted small">{new Date(h.modified).toLocaleDateString()} · {size(h.size)}</span>
                <button type="button" className="btn btn--small" onClick={() => api.openFile(h.docId).catch((e) => setMsg({ ok: false, text: (e as Error).message }))}>Open</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
