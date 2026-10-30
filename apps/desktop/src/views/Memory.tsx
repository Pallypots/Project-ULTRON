import { useEffect, useState } from "react";
import type { Memory, MemoryKind } from "@ultron/schemas";
import { api } from "../api.ts";

const KINDS: MemoryKind[] = ["preference", "fact", "project", "note"];

export function MemoryView() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<MemoryKind>("preference");
  const [error, setError] = useState<string | null>(null);

  const load = () => api.memories().then((r) => setMemories(r.memories)).catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const exportAll = async () => {
    const data = await api.exportMemories();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ultron-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shown = memories.filter((m) => m.content.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Memory Vault</h1>
          <p className="muted">Everything ULTRON remembers about you. Only things you explicitly asked it to remember, or added here, are stored. Deleting a memory removes it permanently from what ULTRON can use.</p>
        </div>
        <button className="btn" onClick={exportAll} disabled={!memories.length}>Export JSON</button>
      </header>

      <form className="panel add-memory" onSubmit={(e) => { e.preventDefault(); if (newText.trim()) act(async () => { await api.createMemory({ content: newText.trim(), kind: newKind }); setNewText(""); }); }}>
        <label htmlFor="new-memory" className="sr-only">New memory</label>
        <input id="new-memory" value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Add something for ULTRON to remember…" />
        <label htmlFor="new-kind" className="sr-only">Type</label>
        <select id="new-kind" value={newKind} onChange={(e) => setNewKind(e.target.value as MemoryKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button className="btn btn--primary" type="submit">Add</button>
      </form>

      {error && <div className="banner banner--error" role="alert">{error}</div>}

      <div className="toolbar">
        <label htmlFor="mem-filter" className="sr-only">Filter memories</label>
        <input id="mem-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${memories.length} memories…`} />
      </div>

      {shown.length === 0 && <p className="empty">{memories.length ? "No memories match that filter." : 'Nothing saved yet. In chat, say "Remember that…" or add one above.'}</p>}

      <ul className="memories">
        {shown.map((m) => (
          <li key={m.id} className={`memory ${m.pinned ? "is-pinned" : ""}`}>
            <div className="memory__top">
              <span className="tag tag--accent">{m.kind}</span>
              {m.pinned && <span className="tag">pinned</span>}
              {m.sensitivity !== "normal" && <span className="tag tag--warn">{m.sensitivity}</span>}
              <span className="memory__id">memory:{m.id.slice(0, 8)}</span>
            </div>
            {editing === m.id ? (
              <form className="memory__edit" onSubmit={(e) => { e.preventDefault(); act(async () => { await api.updateMemory(m.id, { content: editText }); setEditing(null); }); }}>
                <label htmlFor={`edit-${m.id}`} className="sr-only">Edit memory</label>
                <textarea id={`edit-${m.id}`} value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} autoFocus />
                <div className="row">
                  <button className="btn btn--primary" type="submit">Save</button>
                  <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <p className="memory__content">{m.content}</p>
            )}
            <div className="memory__foot">
              <span className="muted small">
                {m.source === "chat" ? "Saved from chat" : m.source === "manual" ? "Added in vault" : "Imported"} · {new Date(m.createdAt).toLocaleString()}
                {m.updatedAt !== m.createdAt && ` · edited ${new Date(m.updatedAt).toLocaleDateString()}`}
              </span>
              <div className="row">
                <button className="btn btn--small" onClick={() => { setEditing(m.id); setEditText(m.content); }}>Edit</button>
                <button className="btn btn--small" onClick={() => act(() => api.updateMemory(m.id, { pinned: !m.pinned }))}>{m.pinned ? "Unpin" : "Pin"}</button>
                <button className="btn btn--small btn--danger" onClick={() => { if (confirm(`Forget "${m.content}"? This can't be undone.`)) act(() => api.deleteMemory(m.id)); }}>Forget</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
