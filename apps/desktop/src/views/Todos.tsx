import { useEffect, useState } from "react";
import { api, type Todo } from "../api.ts";

/** The to-do list ULTRON keeps for you. Chat ("add milk to my list", "I paid the bill") and this panel edit the same list. */
export function TodoPanel({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api.todos().then((r) => setItems(r.todos)).catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, [refreshKey]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const open = items.filter((t) => !t.doneAt);
  const done = items.filter((t) => t.doneAt);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="panel" aria-labelledby="todo-title">
      <h2 className="panel__title" id="todo-title">To-do list</h2>
      <form className="add-memory" onSubmit={(e) => { e.preventDefault(); if (text.trim()) act(async () => { await api.addTodo(text.trim()); setText(""); }); }}>
        <label htmlFor="todo-text" className="sr-only">New to-do</label>
        <input id="todo-text" value={text} onChange={(e) => setText(e.target.value)} placeholder='Add an item, or tell ULTRON "add … to my list"' />
        <button className="btn btn--primary" type="submit">Add item</button>
      </form>
      {error && <div className="banner banner--error" role="alert">{error}</div>}
      {open.length === 0 && <p className="muted">Nothing on your list. Suspiciously productive.</p>}
      <ul className="todos">
        {open.map((t) => (
          <li key={t.id} className="todo">
            <label className="toggle">
              <input type="checkbox" checked={false} onChange={() => act(() => api.updateTodo(t.id, { done: true }))} aria-label={`Done: ${t.text}`} />
              <span>{t.text}</span>
            </label>
            {t.dueDate && <span className={`tag ${t.dueDate < today ? "tag--warn" : ""}`}>{t.dueDate < today ? "overdue " : "due "}{t.dueDate}</span>}
            <button type="button" className="btn btn--small" onClick={() => act(() => api.deleteTodo(t.id))} aria-label={`Delete ${t.text}`}>✕</button>
          </li>
        ))}
        {done.map((t) => (
          <li key={t.id} className="todo todo--done">
            <label className="toggle">
              <input type="checkbox" checked onChange={() => act(() => api.updateTodo(t.id, { done: false }))} aria-label={`Not done: ${t.text}`} />
              <span>{t.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
