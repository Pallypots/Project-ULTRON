import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatEvent, Conversation, Message } from "@ultron/schemas";
import { api, sendMessage, type Status } from "../api.ts";
import { Core, type CoreState } from "../Core.tsx";
import { usePushToTalk } from "../voice/usePushToTalk.ts";
import { Speaker, voiceMode, type TtsEngineId } from "../voice/speaker.ts";
import { SentenceSplitter } from "@ultron/audio";
import { Markdown } from "../Markdown.tsx";
import { Council } from "../council/Council.tsx";
import { CameraModal } from "../voice/Camera.tsx";
import { LiveMeter } from "../voice/live.tsx";
import type { FaceMood } from "../council/face.ts";
import { ENDS_CONVERSATION } from "@ultron/audio";
import { ToolChips } from "../ToolChips.tsx";
import { useHandsFree } from "../voice/handsFree.ts";
import { loadVoicePrefs } from "../voice/prefs.ts";

interface UiMessage extends Message {
  citations?: { id: string; content: string }[];
  notice?: string;
}

const FILLER_AFTER_MS = 2500;
const FILLERS = ["Hmm, let me think.", "Give me a second.", "Thinking.", "Good question. One moment.", "Let me see.", "Mm, working on it."];
let lastFiller = -1;
/** A short spoken "thinking" sound, never the same one twice in a row. */
function pickFiller(): string {
  let i = Math.floor(Math.random() * FILLERS.length);
  if (i === lastFiller) i = (i + 1) % FILLERS.length;
  lastFiller = i;
  return FILLERS[i]!;
}

export function ChatView({ onCoreState, core, seed, seedSpeak, clearSeed, talk, clearTalk, status, onChanged, council, onExitCouncil }: {
  onCoreState: (s: CoreState) => void;
  core: CoreState;
  seed: string | null;
  /** Read the answer to the seeded question aloud (e.g. the morning digest). */
  seedSpeak?: boolean;
  clearSeed: () => void;
  /** Opened from "Talk to ULTRON": start a fresh conversation, listening right away. */
  talk?: boolean;
  clearTalk?: () => void;
  status: Status | null;
  onChanged: () => void;
  /** Council mode: full-screen face, open microphone. */
  council?: boolean;
  onExitCouncil?: () => void;
}) {
  // Counts redraws of the chat screen (read by the responsiveness test; nearly free).
  (window as unknown as { __ultronChatRenders?: number }).__ultronChatRenders = ((window as unknown as { __ultronChatRenders?: number }).__ultronChatRenders ?? 0) + 1;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem("ultron.activeConversation"));
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tts = useRef<{ engine: TtsEngineId; speed: number }>({ engine: "local", speed: 1 });
  const speaker = useRef<Speaker | null>(null);
  if (!speaker.current) speaker.current = new Speaker(() => tts.current.engine, () => loadVoicePrefs().browserVoice, () => tts.current.speed);
  const [speaking, setSpeaking] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const photoRef = useRef<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [speakError, setSpeakError] = useState<string | null>(null);

  useEffect(() => {
    const sp = speaker.current!;
    sp.onChange = setSpeaking;
    sp.onError = (m) => setSpeakError(m);
    api.ttsStatus().then((s) => (tts.current = { engine: s.engine, speed: s.speed })).catch(() => {});
    return () => sp.stop();
  }, []);

  // Voice level, read live by the meters and the face (never stored in React state: that re-rendered the chat 60×/s).
  const speakingRef = useRef(false);
  speakingRef.current = speaking;
  const getSpeakLevel = useCallback(() => (speakingRef.current ? speaker.current!.level() : 0), []);

  const stopSpeaking = useCallback(() => speaker.current?.stop(), []);

  // Approvals made anywhere (this chip, Activity page, another window) update the chips in place.
  useEffect(() => {
    const onAction = (ev: Event) => {
      const x = (ev as CustomEvent<{ id: string; status: string; summary: string; tool: string; risk: number }>).detail;
      setMessages((cur) =>
        cur.map((m) =>
          m.toolEvents?.some((t) => t.executionId === x.id)
            ? { ...m, toolEvents: m.toolEvents.map((t) => (t.executionId === x.id ? { ...t, status: x.status } : t)) }
            : m,
        ),
      );
    };
    window.addEventListener("ultron-action", onAction);
    return () => window.removeEventListener("ultron-action", onAction);
  }, []);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadList = useCallback(async () => {
    const { conversations } = await api.conversations();
    setConversations(conversations);
    return conversations;
  }, []);

  // The conversation the owner most recently picked; late responses for any other one are ignored.
  const wanted = useRef<string | null>(null);
  // A message sent while a new conversation is still being created must go to the new one, never the previous one.
  const creating = useRef<Promise<string> | null>(null);
  const open = useCallback(async (id: string) => {
    wanted.current = id;
    try {
      const { messages } = await api.conversation(id);
      if (wanted.current !== id) return;
      setActiveId(id);
      setMessages(messages);
      localStorage.setItem("ultron.activeConversation", id);
    } catch {
      if (wanted.current === id) wanted.current = null;
      setActiveId(null);
      setMessages([]);
      localStorage.removeItem("ultron.activeConversation");
    }
  }, []);

  useEffect(() => {
    loadList().then((list) => {
      // Opened from Home with a question or "Talk": a new conversation is already on its way, don't jump back to an old one.
      if (creating.current || wanted.current) return;
      const id = activeId && list.some((c) => c.id === activeId) ? activeId : list[0]?.id;
      if (id) open(id);
    }).catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth" });
  }, [messages]);

  const newConversation = () => {
    const p = (async () => {
      const { conversation } = await api.createConversation();
      wanted.current = conversation.id;
      setActiveId(conversation.id);
      setMessages([]);
      localStorage.setItem("ultron.activeConversation", conversation.id);
      inputRef.current?.focus();
      loadList().catch(() => {});
      return conversation.id;
    })();
    creating.current = p;
    p.finally(() => {
      if (creating.current === p) creating.current = null;
    }).catch(() => {});
    return p;
  };

  const send = useCallback(async (text: string, inputMode: "text" | "voice" = "text", continueFrom?: string, speakReply = false) => {
    if (!text.trim() && photoRef.current && !continueFrom) text = "What do you see?";
    if (!text.trim() || busy) return;
    // "Council mode" / "Ultron, council" opens the full-screen face (handled by the app, not the brain).
    if (/^\s*(?:(?:hey|ok)\s+)?(?:ultron[\s,:!.-]+)?(?:enter|start|open|activate|go to|switch to)?\s*(?:the\s+)?council(?:\s+mode)?[\s.!]*$/i.test(text)) {
      window.dispatchEvent(new Event("ultron-council"));
      return;
    }
    // "Read that out" / "say that again": speak the last answer, without asking the brain again.
    if (!continueFrom && /^\s*(?:ultron[\s,]+)?(?:please\s+)?(?:read (?:that|it|this) (?:out|aloud|to me)(?: please)?|read (?:that|it) out loud|say that again|repeat that|what did you say)[\s?.!]*$/i.test(text)) {
      const last = [...messagesRef.current].reverse().find((m) => m.role === "assistant" && m.content.trim());
      if (last) {
        const sp0 = speaker.current!;
        sp0.unlock();
        sp0.stop();
        const sentences = new SentenceSplitter();
        sp0.enqueue([...sentences.push(last.content), ...sentences.flush()]);
        return;
      }
    }
    setError(null);
    setSpeakError(null);
    const sp = speaker.current!;
    sp.stop();
    sp.unlock();
    const mode = loadVoicePrefs().speakMode;
    const splitter = mode === "always" || (mode === "voice" && (inputMode === "voice" || speakReply)) ? new SentenceSplitter() : null;
    // A camera photo the owner just took goes with this one message (never with an approval follow-up).
    const image = continueFrom ? undefined : (photoRef.current ?? undefined);
    photoRef.current = null;
    setPhoto(null);
    setBusy(true);
    onCoreState("thinking");
    // wanted.current updates synchronously on "New conversation"/selection, so a fast Enter can't go to the old chat.
    const id = creating.current ? await creating.current : (wanted.current ?? activeId ?? (await newConversation()));
    const ctl = new AbortController();
    abortRef.current = ctl;
    let assistantId = "";
    // In a spoken conversation, silence while a slow brain thinks feels broken: say something short, like a person would.
    let filler: ReturnType<typeof setTimeout> | null = splitter && inputMode === "voice" ? setTimeout(() => sp.enqueue([pickFiller()]), FILLER_AFTER_MS) : null;
    const noFiller = () => {
      if (filler) clearTimeout(filler);
      filler = null;
    };
    const patch = (fn: (m: UiMessage) => UiMessage) => setMessages((cur) => cur.map((m) => (m.id === assistantId ? fn(m) : m)));
    try {
      await sendMessage(id, text, (e: ChatEvent) => {
        switch (e.type) {
          case "start":
            assistantId = e.assistantMessageId;
            setMessages((cur) => [...cur, e.userMessage, { ...e.userMessage, id: e.assistantMessageId, role: "assistant", content: "", status: "streaming", provider: e.provider, model: e.model, memoryIds: [], toolEvents: [] }]);
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
          case "tool":
            patch((m) => ({ ...m, toolEvents: [...(m.toolEvents ?? []).filter((t) => t.executionId !== e.event.executionId), e.event] }));
            break;
          case "brain_changed":
            patch((m) => ({ ...m, notice: e.where === "local" ? `Brain: local ${e.model}` : e.where === "cloud" ? `Brain: cloud ${e.model}` : "Brain: test" }));
            onChanged();
            break;
          case "memory_blocked":
            patch((m) => ({ ...m, notice: "Not saved: sensitive data" }));
            break;
          case "delta":
            noFiller();
            onCoreState("speaking");
            patch((m) => ({ ...m, content: m.content + e.text }));
            if (splitter) sp.enqueue(splitter.push(e.text));
            break;
          case "done":
            if (splitter) sp.enqueue(splitter.flush());
            patch((m) => ({ ...m, ...e.message, citations: m.citations, notice: m.notice }));
            break;
          case "error":
            setError(e.message);
            onCoreState("error");
            break;
        }
      }, ctl.signal, inputMode, continueFrom, image);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
      else patch((m) => ({ ...m, status: "cancelled" }));
    } finally {
      noFiller();
      setBusy(false);
      abortRef.current = null;
      // The voice may still be reading the reply after the text has finished streaming.
      onCoreState(speaker.current?.speaking ? "speaking" : "idle");
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
  const ptt = usePushToTalk(onTranscript, !busy, stopSpeaking);
  const councilRef = useRef(false);
  councilRef.current = Boolean(council);
  const onWakeCommand = useCallback((text: string) => {
    // "That's all" ends Council mode (after ULTRON says goodbye).
    if (councilRef.current && ENDS_CONVERSATION.test(text)) setTimeout(() => window.dispatchEvent(new Event("ultron-council-exit")), 2500);
    return send(text, "voice");
  }, [send]);
  // An approved action ULTRON needs the result of: carry on in the conversation it came from.
  useEffect(() => {
    const go = (ev: Event) => {
      const a = (ev as CustomEvent<{ id: string; summary: string }>).detail;
      if (!messages.some((m) => m.toolEvents?.some((t) => t.executionId === a.id))) return;
      send(`✓ Approved: ${a.summary}`, "text", a.id);
    };
    window.addEventListener("ultron-continue", go);
    return () => window.removeEventListener("ultron-continue", go);
  }, [messages, send]);
  const hands = useHandsFree(onWakeCommand, busy || speaking || ptt.state !== "idle", {
    speaking,
    // You talked over ULTRON: stop the voice and the reply, and listen.
    onBargeIn: () => {
      console.info("[ultron] interrupted by voice");
      abortRef.current?.abort();
      stopSpeaking();
    },
  });
  // Council mode: a fresh conversation with the microphone open (no wake word) until you leave.
  const [councilLine, setCouncilLine] = useState("");
  useEffect(() => {
    if (!council) return;
    voiceMode.council = true;
    api.greeting().catch(() => {}); // also wakes the local brain so the first answer is quick
    const sir = status?.persona.salutation ? `, ${status.persona.salutation}` : "";
    const lines = [`The council is in session. What's on your mind${sir}?`, `Ah, face to face at last${sir}. Go on, I'm listening.`, `I'm all yours${sir}. No strings, no wake word. Talk to me.`, `Here I am${sir}. What shall we discuss?`];
    const line = lines[Math.floor(Math.random() * lines.length)]!;
    setCouncilLine(line);
    speaker.current?.unlock();
    speaker.current?.enqueue([line]);
    newConversation().then(() => hands.start({ conversation: true, openMic: true }));
    const exit = () => onExitCouncil?.();
    window.addEventListener("ultron-council-exit", exit);
    return () => {
      window.removeEventListener("ultron-council-exit", exit);
      voiceMode.council = false;
      hands.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [council]);
  // The face reads this every frame.
  const handsHearing = hands.state === "hearing" || hands.state === "awake";
  const handsHearingRef = useRef(handsHearing);
  handsHearingRef.current = handsHearing;
  const coreLevel = useCallback(() => ptt.getLevel() || getSpeakLevel() || (handsHearingRef.current ? hands.getLevel() : 0), [ptt.getLevel, getSpeakLevel, hands.getLevel]);
  const faceLevel = useMemo(() => ({ get current() { return speakingRef.current ? getSpeakLevel() : hands.getLevel() * 0.35; } }), [getSpeakLevel, hands.getLevel]);
  const councilMood: FaceMood = speaking ? "speaking" : busy || hands.state === "checking" || ptt.state === "transcribing" ? "thinking" : hands.state === "hearing" || ptt.state === "listening" ? "listening" : core === "offline" ? "offline" : "idle";
  const lastOf = (role: string) => [...messages].reverse().find((m) => m.role === role)?.content ?? "";

  useEffect(() => {
    if (!talk) return;
    clearTalk?.();
    newConversation().then(() => hands.start({ conversation: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talk]);
  const HF_LABEL: Record<string, string> = {
    starting: "Starting hands-free…",
    listening: 'Hands-free · say "Ultron, …" (anything else is ignored and discarded)',
    hearing: "Hands-free · hearing speech…",
    checking: "Hands-free · checking for the wake word (on this PC)…",
    awake: "Yes? I'm listening for your request…",
    paused: "Hands-free · paused while ULTRON is busy",
    followup: "Conversation · I'm listening, just reply (no \"Ultron\" needed) · say \"that's all\" to stop",
  };

  useEffect(() => {
    if (ptt.state === "listening") onCoreState("listening");
    else if (ptt.state === "transcribing") onCoreState("thinking");
    else if (speaking) onCoreState("speaking");
    else if (!busy) onCoreState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptt.state, speaking]);

  // Esc anywhere silences ULTRON while it's talking.
  useEffect(() => {
    if (!speaking) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stopSpeaking();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speaking, stopSpeaking]);

  useEffect(() => {
    if (seed) {
      clearSeed();
      // Questions from Home or a feed card are new topics: start a fresh conversation so they never collide
      // with a reply still finishing in the previous one.
      const speak = Boolean(seedSpeak);
      newConversation().then(() => send(seed, "text", undefined, speak));
    }
  }, [seed, clearSeed, send]);

  const retry = async () => {
    const id = activeId;
    if (!id || busy) return;
    try {
      const { content, inputMode } = await api.retry(id);
      setMessages((cur) => {
        const i = cur.map((m) => m.role).lastIndexOf("user");
        return i < 0 ? cur : cur.slice(0, i);
      });
      await send(content, inputMode);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stop = () => {
    stopSpeaking();
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

  if (council)
    return (
      <>
      {camera && <CameraModal onClose={() => setCamera(false)} onPhoto={(p) => { photoRef.current = p; setPhoto(p); setCamera(false); }} />}
      <Council
        photoReady={Boolean(photo)}
        onCamera={() => setCamera(true)}
        mood={councilMood}
        level={faceLevel}
        said={lastOf("assistant") || councilLine}
        heard={lastOf("user").startsWith("✓ Approved") ? "" : lastOf("user")}
        brain={status ? (status.where === "test" ? "Test brain" : `${status.where === "local" ? "Local" : "Cloud"} brain · ${status.model}`) : ""}
        problem={hands.error ?? speakError ?? error}
        pending={messages.flatMap((m) => m.toolEvents ?? []).filter((t) => t.status === "awaiting_approval")}
        activity={(() => {
          const last = [...messages].reverse().find((m) => m.role === "assistant");
          const t = last?.toolEvents?.at(-1);
          if (!t) return null;
          return t.status === "awaiting_approval" ? `Waiting for your approval: ${t.summary}` : t.status === "running" ? `${t.summary}…` : t.status === "succeeded" ? `✓ ${t.summary}` : null;
        })()}
        onSend={(t) => send(t, "text", undefined, true)}
        onExit={() => onExitCouncil?.()}
      />
      </>
    );

  return (
    <div className="chat">
      <aside className="chat__list" aria-label="Conversations">
        <button className="btn btn--primary btn--block" onClick={newConversation}>+ New conversation</button>
        <ul>
          {conversations.map((c) => (
            <li key={c.id} className={c.id === activeId ? "is-active" : ""}>
              <button className="chat__item" onClick={() => open(c.id)} aria-current={c.id === activeId ? "true" : undefined} title={c.summary ? `ULTRON's note: ${c.summary}` : undefined}>
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
          <Core state={core} size={56} levelSource={coreLevel} />
          <div>
            <h1 className="chat__heading">{conversations.find((c) => c.id === activeId)?.title ?? "New conversation"}</h1>
            <p className="muted small">{status ? (status.where === "test" ? "Built-in test brain (canned replies)" : status.where === "local" ? `Local brain · ${status.model} · on this PC` : `Cloud brain · ${status.provider} · ${status.model}`) : ""}</p>
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
                {m.content ? (m.role === "assistant" ? <Markdown text={m.content} /> : m.content) : m.status === "streaming" ? <span className="typing" aria-label="ULTRON is thinking"><i /><i /><i /></span> : null}
              </div>
              {m.toolEvents?.length > 0 && <ToolChips events={m.toolEvents} />}
              {m.role === "assistant" && m.id === messages.at(-1)?.id && !busy && m.status !== "streaming" && (
                <button type="button" className="link retry" onClick={retry} title="Ask again for a different answer">↻ Try again</button>
              )}
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
        {hands.error && (
          <div className="banner banner--error" role="alert">
            {hands.error} <button className="link" onClick={hands.clearError}>Dismiss</button>
          </div>
        )}
        {hands.on && ptt.state === "idle" && !speaking && (
          <div className={`listening listening--hands listening--${hands.state}`} role="status" aria-live="polite">
            <span className="listening__dot" aria-hidden="true" />
            {HF_LABEL[hands.state] ?? ""}
            <LiveMeter source={hands.getLevel} />
            <button type="button" className="btn btn--small" onClick={hands.stop}>Turn off</button>
          </div>
        )}
        {speakError && (
          <div className="banner banner--warn" role="alert">
            Couldn't speak the reply: {speakError} <button className="link" onClick={() => setSpeakError(null)}>Dismiss</button>
          </div>
        )}
        {speaking && ptt.state === "idle" && (
          <div className="listening listening--speaking" role="status" aria-live="polite">
            <span className="listening__dot" aria-hidden="true" />
            ULTRON is speaking · press Talk to interrupt, or Esc
            <LiveMeter source={getSpeakLevel} />
            <button type="button" className="btn btn--small" onClick={stopSpeaking}>Stop speaking</button>
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
            <LiveMeter source={ptt.getLevel} />
          </div>
        )}

        {camera && <CameraModal onClose={() => setCamera(false)} onPhoto={(p) => { photoRef.current = p; setPhoto(p); setCamera(false); inputRef.current?.focus(); }} />}
        {photo && (
          <div className="row" style={{ margin: "0 12px" }}>
            <span className="photo-chip">📸 Photo ready: it goes with your next message (typed or spoken)</span>
            <button type="button" className="link" onClick={() => { photoRef.current = null; setPhoto(null); }}>Remove</button>
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
            <button type="submit" className="btn btn--primary" disabled={!draft.trim() && !photo}>Send</button>
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
          <button
            type="button"
            className={`btn ${hands.on ? "mic--hands" : ""}`}
            aria-pressed={hands.on}
            title='Hands-free: keeps the microphone on and responds when you start with "Ultron". Speech recognition runs on this PC; anything not addressed to ULTRON is discarded.'
            onClick={() => (hands.on ? hands.stop() : hands.start())}
          >
            🎧 {hands.on ? "Hands-free on" : "Hands-free"}
          </button>
          <button type="button" className="btn" onClick={() => setCamera(true)} disabled={busy} aria-label="Show ULTRON something with the camera" title="Show ULTRON something: take one photo for your next message">
            📷
          </button>
        </form>
      </section>
    </div>
  );
}
