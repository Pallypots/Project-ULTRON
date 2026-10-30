import type { AuditEvent, Capability, ChatEvent, Conversation, InputMode, Memory, MemoryKind, Message, TranscribeResult, TtsStatusResponse, VoiceStatus } from "@ultron/schemas";

let token: string | null = null;

async function getToken(): Promise<string> {
  if (token) return token;
  const res = await fetch("/api/bootstrap");
  if (!res.ok) throw new Error("ULTRON refused the session. Open it from this computer.");
  token = ((await res.json()) as { token: string }).token;
  return token;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${await getToken()}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) token = null;
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError((data as { message?: string })?.message ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export async function health(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface Status {
  version: string;
  provider: string;
  model: string;
  providerReady: boolean;
  where: "local" | "cloud" | "test";
  pendingApprovals: number;
  secretsProblem: string | null;
  secretsProtection: "dpapi" | "file-permissions";
  upcomingReminders: number;
  providerProblem: string | null;
  activeReplies: number;
  counts: { conversations: number; memories: number };
  persona: { name: string; wakeNames: string[]; salutation: string };
}

export interface Reminder {
  id: string;
  text: string;
  dueAt: string;
  status: "scheduled" | "fired" | "missed" | "cancelled";
  source: string;
  createdAt: string;
  firedAt: string | null;
}
export interface PersonaInfo {
  name: string;
  ownerSalutation: string;
  wakeNames: string[];
  traits: string[];
  style: string;
  tone: { humor: number; sarcasm: number; formality: number; verbosity: "brief" | "adaptive" | "detailed" };
  boundaries: string[];
}
export interface ConnectorInfo {
  id: string;
  label: string;
  available: boolean;
  connected: boolean;
  account: string | null;
  capabilities: string[];
  health: "not_connected" | "ok" | "error" | "rate_limited" | "syncing";
  healthDetail: string;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  repos?: string[];
  note: string;
}
export interface FeedEvent {
  id: string;
  source: string;
  resourceType: string;
  title: string;
  summary: string;
  canonicalUrl: string | null;
  occurredAt: string;
  urgency: number;
  readState: "unread" | "read" | "saved";
  why: string;
}
export interface FolderInfo {
  id: string;
  path: string;
  status: "pending" | "indexing" | "ready" | "error";
  detail: string;
  fileCount: number;
  indexedAt: string | null;
}
export interface FileHit {
  docId: string;
  path: string;
  name: string;
  ext: string;
  size: number;
  modified: string;
  snippet: string;
}
export interface ActionRecord {
  id: string;
  conversationId: string | null;
  tool: string;
  input: Record<string, unknown>;
  risk: number;
  status: string;
  requestedBy: string;
  summary: string;
  result: string | null;
  error: string | null;
  createdAt: string;
  preview?: string;
}
export interface ActionPolicy {
  paused: boolean;
  confirmLowRisk: boolean;
}
export type ServerEvent =
  | { type: "hello"; at: string }
  | { type: "reminder_fired"; reminder: Reminder }
  | { type: "reminders_missed"; reminders: Reminder[] }
  | { type: "action_updated"; execution: ActionRecord }
  | { type: "connector_synced"; source: string; added: number };

/** Keeps a live connection for reminders and approvals; reconnects with backoff. Returns a stop function. */
export function subscribeEvents(onEvent: (e: ServerEvent) => void): () => void {
  let stopped = false;
  let ctl: AbortController | null = null;
  const loop = async () => {
    let delay = 1000;
    while (!stopped) {
      ctl = new AbortController();
      try {
        const res = await fetch("/api/events", { headers: { authorization: `Bearer ${await getToken()}` }, signal: ctl.signal });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        delay = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (frame.startsWith("data: ")) onEvent(JSON.parse(frame.slice(6)) as ServerEvent);
          }
        }
      } catch {
        /* offline or restarting; retry */
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15000);
    }
  };
  loop();
  return () => {
    stopped = true;
    ctl?.abort();
  };
}

export interface LocalAiStatus {
  ollama: { running: boolean; version: string | null; url: string };
  models: { name: string; sizeBytes: number; parameterSize: string | null; family: string | null }[];
  pulls: { model: string; status: "downloading" | "success" | "error" | "cancelled"; detail: string; completedBytes: number; totalBytes: number }[];
  hardware: { ramGb: number; cpuThreads: number; gpus: { name: string; vramGb: number; vendor: string }[]; usableGpu: { name: string; vramGb: number } | null };
  recommendation: { primary: ModelSuggestion; alternatives: ModelSuggestion[]; summary: string };
  active: string | null;
}
interface ModelSuggestion {
  model: string;
  label: string;
  approxDownloadGb: number;
  why: string;
}

export interface ProviderSettings {
  provider: "mock" | "ollama" | "anthropic" | "openai";
  model: string;
  baseUrl: string;
  keys: Record<string, boolean>;
}

export const api = {
  status: () => call<Status>("GET", "/api/status"),
  capabilities: () => call<{ capabilities: Capability[] }>("GET", "/api/capabilities"),
  conversations: () => call<{ conversations: Conversation[] }>("GET", "/api/conversations"),
  createConversation: () => call<{ conversation: Conversation }>("POST", "/api/conversations"),
  conversation: (id: string) => call<{ conversation: Conversation; messages: Message[] }>("GET", `/api/conversations/${id}`),
  deleteConversation: (id: string) => call("DELETE", `/api/conversations/${id}`),
  memories: () => call<{ memories: Memory[] }>("GET", "/api/memories"),
  createMemory: (m: { content: string; kind: MemoryKind; pinned?: boolean }) => call<{ memory: Memory }>("POST", "/api/memories", m),
  updateMemory: (id: string, patch: Partial<Pick<Memory, "content" | "kind" | "pinned" | "sensitivity">>) => call<{ memory: Memory }>("PATCH", `/api/memories/${id}`, patch),
  deleteMemory: (id: string) => call("DELETE", `/api/memories/${id}`),
  exportMemories: () => call<unknown>("GET", "/api/memories/export"),
  activity: () => call<{ events: AuditEvent[] }>("GET", "/api/activity"),
  providerSettings: () => call<ProviderSettings>("GET", "/api/settings/provider"),
  saveProviderSettings: (s: { provider: string; model?: string; baseUrl?: string; apiKey?: string }) => call<{ ok: boolean; problem: string | null }>("PUT", "/api/settings/provider", s),
  removeKey: (provider: string) => call("DELETE", `/api/settings/provider/${provider}/key`),
  testProvider: () => call<{ ok: boolean; message: string; sample?: string }>("POST", "/api/settings/provider/test"),
  stopAll: () => call<{ stopped: number }>("POST", "/api/stop"),
  logs: () => call<string>("GET", "/api/logs/export"),
  localAiStatus: () => call<LocalAiStatus>("GET", "/api/local-ai/status"),
  pullLocalModel: (model: string) => call("POST", "/api/local-ai/pull", { model }),
  cancelLocalPull: (model: string) => call("POST", "/api/local-ai/pull/cancel", { model }),
  useLocalModel: (model: string) => call("POST", "/api/local-ai/use", { model }),
  shortcuts: () => call<{ supported: boolean; startAtLogin: boolean; desktopShortcut: boolean }>("GET", "/api/system/shortcuts"),
  setStartAtLogin: (enabled: boolean) => call<{ supported: boolean; startAtLogin: boolean; desktopShortcut: boolean }>("POST", "/api/system/start-at-login", { enabled }),
  createDesktopShortcut: () => call<{ supported: boolean; startAtLogin: boolean; desktopShortcut: boolean }>("POST", "/api/system/desktop-shortcut"),
  greeting: () => call<{ greeting: { text: string; at: string } | null }>("GET", "/api/greeting"),
  persona: () => call<{ persona: PersonaInfo; homeLocation: string }>("GET", "/api/persona"),
  savePersona: (p: Partial<Omit<PersonaInfo, "boundaries" | "traits">> & { homeLocation?: string }) => call<{ persona: PersonaInfo; homeLocation: string }>("PUT", "/api/persona", p),
  resetPersona: () => call<{ persona: PersonaInfo }>("DELETE", "/api/persona"),
  connectors: () => call<{ connectors: ConnectorInfo[] }>("GET", "/api/connectors"),
  connectGithub: (token: string) => call<{ connector: ConnectorInfo }>("POST", "/api/connectors/github/connect", { token }),
  githubRepos: () => call<{ repos: { fullName: string; private: boolean }[] }>("GET", "/api/connectors/github/repos"),
  setGithubRepos: (repos: string[]) => call("PUT", "/api/connectors/github/repos", { repos }),
  syncGithub: () => call<{ added: number }>("POST", "/api/connectors/github/sync"),
  disconnectGithub: () => call("DELETE", "/api/connectors/github"),
  feed: (important = false) => call<{ events: FeedEvent[] }>("GET", `/api/feed${important ? "?important=1" : ""}`),
  markFeedRead: (ids: string[] | "all") => call("POST", "/api/feed/read", { ids }),
  folders: () => call<{ folders: FolderInfo[]; indexing: boolean }>("GET", "/api/files/folders"),
  addFolder: (path: string) => call<{ folder: FolderInfo }>("POST", "/api/files/folders", { path }),
  removeFolder: (id: string) => call("DELETE", `/api/files/folders/${id}`),
  reindexFolder: (id: string) => call("POST", `/api/files/folders/${id}/reindex`),
  searchFiles: (query: string) => call<{ results: FileHit[] }>("POST", "/api/files/search", { query }),
  openFile: (docId: string) => call("POST", "/api/files/open", { docId }),
  reminders: () => call<{ reminders: Reminder[] }>("GET", "/api/reminders"),
  createReminder: (text: string, dueAt: string) => call<{ reminder: Reminder }>("POST", "/api/reminders", { text, dueAt }),
  cancelReminder: (id: string) => call("POST", `/api/reminders/${id}/cancel`),
  actions: () => call<{ actions: ActionRecord[]; pending: ActionRecord[]; policy: ActionPolicy }>("GET", "/api/actions"),
  approveAction: (id: string) => call<{ action: ActionRecord }>("POST", `/api/actions/${id}/approve`),
  denyAction: (id: string) => call<{ action: ActionRecord }>("POST", `/api/actions/${id}/deny`),
  saveActionPolicy: (p: ActionPolicy) => call<{ policy: ActionPolicy }>("PUT", "/api/settings/actions", p),
  setHandsFree: (enabled: boolean) => call<{ enabled: boolean; wakeNames: string[] }>("POST", "/api/voice/handsfree", { enabled }),
  voiceStatus: () => call<VoiceStatus>("GET", "/api/voice/status"),
  saveVoiceSettings: (s: { engine: VoiceStatus["engine"]; model?: string }) => call<VoiceStatus>("PUT", "/api/voice/settings", s),
  prepareVoice: () => call<VoiceStatus>("POST", "/api/voice/prepare"),
  ttsStatus: () => call<TtsStatusResponse>("GET", "/api/voice/tts/status"),
  saveTtsSettings: (s: { engine: TtsStatusResponse["engine"]; voice?: string; speed?: number }) => call<TtsStatusResponse>("PUT", "/api/voice/tts/settings", s),
  prepareTts: () => call<TtsStatusResponse>("POST", "/api/voice/tts/prepare"),
};

/** Fetches spoken audio (WAV) for one sentence; null when there's nothing to say. */
export async function speak(text: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const res = await fetch("/api/voice/speak", {
    method: "POST",
    headers: { authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError((data as { message?: string }).message ?? `Speech failed (${res.status})`, res.status);
  }
  return res.arrayBuffer();
}

/** Hands-free: the server checks for the wake word and returns words only when they were addressed to ULTRON. */
export async function transcribeWake(wav: Uint8Array, requireWakeWord: boolean): Promise<{ addressed: boolean; text?: string }> {
  const res = await fetch(`/api/voice/transcribe${requireWakeWord ? "?mode=wake" : ""}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await getToken()}`, "content-type": "audio/wav" },
    body: wav as BodyInit,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 422 || res.status === 400) return { addressed: false };
  if (!res.ok) throw new ApiError((data as { message?: string }).message ?? `Listening failed (${res.status})`, res.status);
  return requireWakeWord ? (data as { addressed: boolean; text?: string }) : { addressed: true, text: (data as { text: string }).text };
}

export async function transcribe(wav: Uint8Array): Promise<TranscribeResult> {
  const res = await fetch("/api/voice/transcribe", {
    method: "POST",
    headers: { authorization: `Bearer ${await getToken()}`, "content-type": "audio/wav" },
    body: wav as BodyInit,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { message?: string }).message ?? `Transcription failed (${res.status})`, res.status);
  return data as TranscribeResult;
}

/** Sends a message and calls `onEvent` for each streamed server event. */
export async function sendMessage(conversationId: string, content: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal, inputMode: InputMode = "text"): Promise<void> {
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ content, deviceId: deviceId(), inputMode }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError((data as { message?: string }).message ?? `Request failed (${res.status})`, res.status);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (frame.startsWith("data: ")) onEvent(JSON.parse(frame.slice(6)) as ChatEvent);
    }
  }
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem("ultron.deviceId");
    if (!id) {
      id = `desktop-${crypto.randomUUID().slice(0, 8)}`;
      localStorage.setItem("ultron.deviceId", id);
    }
    return id;
  } catch {
    return "desktop";
  }
}
