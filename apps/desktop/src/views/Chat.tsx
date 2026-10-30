import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, Conversation, Message } from "@ultron/schemas";
import { api, sendMessage, type Status } from "../api.ts";
import { Core, type CoreState } from "../Core.tsx";
import { usePushToTalk } from "../voice/usePushToTalk.ts";
import { loadVoicePrefs } from "../voice/prefs.ts";

interface UiMessage extends Message {
  citations?: { id: string; content: string }[];
  notice?: string;
}

export function ChatView({ onCoreState, core, seed, clearSeed, status, onChanged }: {
  onCoreState: (s: CoreState) => void;
  core: CoreState;
  seed: string | null;
  clearSeed: () => void;
  status: Status | null;
  onChanged: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem("ultron.activeConversation"));
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadList = useCallback(async () => {
    const { conversations } = await api.conversations();
    setConversations(conversations);
    return conversations;
  }, []);

  const open = useCallback(async (id: string) => {
    try {
      const { messages } = await api.conversation(id);
      setActiveId(id);
      setMessages(messages);
      localStorage.setItem("ultron.activeConversation", id);
    } catch {
      setActiveId(null);
      setMessages([]);
      localStorage.removeItem("ultron.activeConversation");
    }
  }, []);

  useEffect(() => {
    loadList().then((list) => {
      const id = activeId && list.some((c) => c.id === activeId) ? activeId : list[0]?.id;
      if (id) open(id);
    }).catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth" });
  }, [messages]);

  const newConversation = async () => {
    const { conversation } = await api.createConversation();
    await loadList();
    setActiveId(conversation.id);
    setMessages([]);
    localStorage.setItem("ultron.activeConversation", conversation.id);
    inputRef.current?.focus();
    return conversation.id;
  };

  const send = useCallback(async (text: string, inputMode: "text" | "voice" = "text") => {
    if (!text.trim() || busy) return;
    setError(null);
    setBusy(true);
    onCoreState("thinking");
    const id = activeId ?? (await newConversation());
    const ctl = new AbortController();
    abortRef.current = ctl;
    let assistantId = "";
    const patch = (fn: (m: UiMessage) => UiMessage) => setMessages((cur) => cur.map((m) => (m.id === assistantId ? fn(m) : m)));
    try {
      await sendMessage(id, text, (e: ChatEvent) => {
        switch (e.type) {
          case "start":
            assistantId = e.assistantMessageId;
            setMessages((cur) => [...cur, e.userMessage, { ...e.userMessage, id: e.assistantMessageId, role: "assistant", content: "", status: "streaming", provider: e.provider, model: e.model, memoryIds: [] }]);
            break;
          case "memories":
            patch((m) => ({ ...m, citations: e.memories.map((x) => ({ id: x.id, content: x.content })) }));
            break;
          case "memory_saved":
            patch((m) => ({ ...m, notice: "Saved to Memory Vault" }));
            break;
          case "memory_forgotten":
            patch((m) => ({ ...m, notice: "Removed from Memory Vault" }));
            break;
          case "memory_blocked":
            patch((m) => ({ ...m, notice: "Not saved: sensitive data" }));
            break;
          case "delta":
            onCoreState("speaking");
            patch((m) => ({ ...m, content: m.content + e.text }));
            break;
          case "done":
            patch((m) => ({ ...m, ...e.message, citations: m.citations, notice: m.notice }));
            break;
          case "error":
            setError(e.message);
            onCoreState("error");
            break;
        }
      }, ctl.signal, inputMode);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
      else patch((m) => ({ ...m, status: "cancelled" }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      onCoreState("idle");
      loadList();
      onChanged();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, busy]);

  const onTranscript = useCallback(
    (text: string) => {
      if (loadVoicePrefs().autoSend) send(text, "voice");
      else {
        setDraft((d) => (d ? `${d} ${text}` : text));
        inputRef.current?.focus();
      }
    },
    [send],
  );
  const ptt = usePushToTalk(onTranscript, !busy);

  useEffect(() => {
    if (ptt.state === "listening") onCoreState("listening");
    else if (ptt.state === "transcribing") onCoreState("thinking");
    else if (!busy) onCoreState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptt.state]);

  useEffect(() => {
    if (seed) {
      clearSeed();
      send(seed);
    }
  }, [seed, clearSeed, send]);

  const stop = () => {
    abortRef.current?.abort();
    api.stopAll().catch(() => {});
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this conversation permanently? Saved memories are kept.")) return;
    await api.deleteConversation(id);
    const list = await loadList();
    if (id === activeId) {
      setMessages([]);
      setActiveId(null);
      if (list[0]) open(list[0].id);
    }
  };

  return (
    <div className="chat">
      <aside className="chat__list" aria-label="Conversations">
        <button className="btn btn--primary btn--block" onClick={newConversation}>+ New conversation</button>
        <ul>
          {conversations.map((c) => (
            <li key={c.id} className={c.id === activeId ? "is-active" : ""}>
              <button className="chat__item" onClick={() => open(c.id)} aria-current={c.id === activeId ? "true" : undefined}>
                <span className="chat__title">{c.title}</span>
                <time className="chat__time">{new Date(c.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
              </button>
              <button className="icon-btn" aria-label={`Delete conversation ${c.title}`} onClick={() => remove(c.id)}>×</button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat__main">
        <header className="chat__header">
          <Core state={core} size={56} level={ptt.level} />
          <div>
            <h1 className="chat__heading">{conversations.find((c) => c.id === activeId)?.title ?? "New conversation"}</h1>
            <p className="muted small">{status ? (status.provider === "mock" ? "Built-in mock model (canned replies)" : `${status.provider} · ${status.model}`) : ""}</p>
          </div>
        </header>

        <div className="messages" aria-live="polite" aria-busy={busy}>
          {messages.length === 0 && (
            <div className="empty">
              <p>Say hello, ask a question, or try <em>"Remember that…"</em> to save something to memory.</p>
            </div>
          )}
          {messages.map((m) => (
            <article key={m.id} className={`msg msg--${m.role} msg--${m.status}`}>
              <div className="msg__who">{m.role === "user" ? (m.inputMode === "voice" ? "You · 🎙 voice" : "You") : "ULTRON"}</div>
              <div className="msg__body">
                {m.content || (m.status === "streaming" ? <span className="typing" aria-label="ULTRON is thinking"><i /><i /><i /></span> : null)}
              </div>
              {(m.notice || m.citations?.length || m.status === "cancelled" || m.status === "error") && (
                <div className="msg__meta">
                  {m.notice && <span className="tag tag--accent">{m.notice}</span>}
                  {m.status === "cancelled" && <span className="tag">Stopped</span>}
                  {m.status === "error" && <span className="tag tag--bad">Error</span>}
                  {m.citations?.map((c) => (
                    <span key={c.id} className="tag" title={c.content}>memory:{c.id.slice(0, 8)} · {c.content.length > 40 ? c.content.slice(0, 40) + "…" : c.content}</span>
                  ))}
                </div>
              )}
            </article>
          ))}
          <div ref={endRef} />
        </div>

        {error && <div className="banner banner--error" role="alert">{error}</div>}
        {ptt.error && (
          <div className="banner banner--error" role="alert">
            {ptt.error} <button className="link" onClick={ptt.clearError}>Dismiss</button>
          </div>
        )}
        {ptt.state !== "idle" && (
          <div className={`listening listening--${ptt.state}`} role="status" aria-live="assertive">
            <span className="listening__dot" aria-hidden="true" />
            {ptt.state === "transcribing"
              ? "Transcribing…"
              : ptt.state === "starting"
                ? "Opening microphone…"
                : `Listening · ${Math.floor(ptt.seconds / 60)}:${String(Math.floor(ptt.seconds % 60)).padStart(2, "0")} · release to send, Esc to cancel`}
            <span className="listening__meter" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(0.02, ptt.level)})` }} /></span>
          </div>
        )}

        <form className="composer" onSubmit={(e) => { e.preventDefault(); const t = draft; setDraft(""); send(t); }}>
          <label htmlFor="composer" className="sr-only">Message ULTRON</label>
          <textarea
            id="composer"
            ref={inputRef}
            value={draft}
            rows={2}
            placeholder="Message ULTRON…  (Enter to send · Shift+Enter new line · Esc stop · click outside and hold Space to talk)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const t = draft;
                setDraft("");
                send(t);
              }
              if (e.key === "Escape" && busy) stop();
            }}
          />
          {busy ? (
            <button type="button" className="btn btn--danger" onClick={stop}>■ Stop</button>
          ) : (
            <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>Send</button>
          )}
          <button
            type="button"
            className={`btn mic ${ptt.state === "listening" ? "mic--on" : ""}`}
            aria-pressed={ptt.state === "listening"}
            aria-label="Push to talk: hold to speak, or click to start and click again to send. Shortcut: hold Space."
            title="Hold to talk (or hold Space). Click once for hands-free; click again to send."
            disabled={busy || ptt.state === "transcribing"}
            onPointerDown={ptt.onPointerDown}
            onPointerUp={ptt.onPointerUp}
            onPointerLeave={ptt.onPointerUp}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (ptt.state === "idle") ptt.onPointerDown(e as unknown as React.PointerEvent); } }}
            onKeyUp={(e) => { if (e.key === "Enter") ptt.onPointerUp(); }}
          >
            🎙 {ptt.state === "listening" ? "Listening" : "Talk"}
          </button>
        </form>
      </section>
    </div>
  );
}
