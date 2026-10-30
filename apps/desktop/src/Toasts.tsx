export interface Toast {
  id: string;
  title: string;
  body: string;
  kind: "reminder" | "warn" | "info";
}

/** Pop-up notices (reminders, missed reminders). Each stays until dismissed so nothing is missed. */
export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="alert">
          <div>
            <strong>{t.title}</strong>
            <div>{t.body}</div>
          </div>
          <button type="button" className="btn btn--small" onClick={() => dismiss(t.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}
