import type { AuditEvent, Capability, ChatEvent, Conversation, InputMode, Memory, MemoryKind, Message, TranscribeResult, TtsStatusResponse, VoiceStatus } from "@ultron/schemas";

let token: string | null = null;
const DEVICE_KEY = "ultron.deviceToken";

/** This browser is a phone (or other device) that needs pairing before it can use ULTRON. */
export class PairRequired extends Error {}
function needPairing(): never {
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* storage unavailable */
  }
  token = null;
  window.dispatchEvent(new Event("ultron-pair-required"));
  throw new PairRequired("Pair this device with ULTRON first.");
}

async function getToken(): Promise<string> {
  if (token) return token;
  const res = await fetch("/api/bootstrap");
  if (res.ok) {
    token = ((await res.json()) as { token: string }).token;
    return token;
  }
  // Opened over Tailscale from a phone: use this device's own key, or ask to pair.
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (data.error === "pair_required") {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(DEVICE_KEY);
    } catch {
      saved = null;
    }
    if (saved) return (token = saved);
    needPairing();
  }
  throw new Error("ULTRON refused the session. Open it from this computer.");
}

/** Pairs this device using the 6-digit code shown on the PC, and keeps the device key in this browser. */
export async function pairDevice(code: string, name: string): Promise<void> {
  const res = await fetch("/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
  const data = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!res.ok || !data.token) throw new Error(data.message ?? "Pairing failed.");
  localStorage.setItem(DEVICE_KEY, data.token);
  token = data.token;
}

/** True when this page was opened on the PC itself (not over Tailscale). */
export const onThisPc = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

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
  if (res.status === 401 && (data as { error?: string })?.error === "pair_required") needPairing(); // removed on the PC
  if (!res.ok) throw new ApiError((data as { message?: string })?.message ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export async function health(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(8000) });
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
export interface WatchedPage {
  id: string;
  url: string;
  label: string;
  lookFor: string | null;
  everyMinutes: number;
  lastCheckedAt: string | null;
  lastError: string | null;
}
export interface Routine {
  id: string;
  name: string;
  phrases: string[];
  steps: string[];
  enabled: boolean;
}
export interface CheckIn {
  enabled: boolean;
  time: string;
  evening: boolean;
  eveningTime: string;
  meetingAlertMinutes: number;
  rainAlerts: boolean;
}
export interface Todo {
  id: string;
  text: string;
  dueDate: string | null;
  doneAt: string | null;
  createdAt: string;
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
  | { type: "connector_synced"; source: string; added: number }
  | { type: "checkin"; title: string; body: string; kind: "morning" | "evening" | "meeting" | "watch" | "weather" };

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
  remote: () => call<{ settings: { enabled: boolean; host: string }; detectedHost: string | null; pairing: boolean; devices: { id: string; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }[] }>("GET", "/api/remote"),
  saveRemote: (s: { enabled: boolean; host: string }) => call<{ settings: { enabled: boolean; host: string } }>("PUT", "/api/remote", s),
  startPairing: () => call<{ code: string; expiresAt: string }>("POST", "/api/remote/pairing"),
  revokeDevice: (id: string) => call("DELETE", `/api/remote/devices/${id}`),
  searchSettings: () => call<SearchStatus>("GET", "/api/settings/search"),
  saveSearchKey: (apiKey: string) => call<SearchStatus>("PUT", "/api/settings/search", { apiKey }),
  saveSearxng: (searxngUrl: string) => call<SearchStatus>("PUT", "/api/settings/search", { searxngUrl }),
  home: () => call<{ home: HomeStatus }>("GET", "/api/home"),
  connectHome: (url: string, token: string) => call<{ home: HomeStatus; devices: number }>("PUT", "/api/home", { url, token }),
  disconnectHome: () => call<{ home: HomeStatus }>("DELETE", "/api/home"),
  homeDevices: () => call<{ devices: { id: string; domain: string; name: string; state: string; summary: string }[] }>("GET", "/api/home/devices"),
  hud: () => call<Hud>("GET", "/api/hud"),
  quit: () => call<{ ok: boolean }>("POST", "/api/system/quit", {}),
  removeSearchKey: () => call<SearchStatus>("DELETE", "/api/settings/search"),
  room: () => call<{ enabled: boolean }>("GET", "/api/voice/room"),
  setRoom: (enabled: boolean) => call<{ enabled: boolean }>("PUT", "/api/voice/room", { enabled }),
  retry: (conversationId: string) => call<{ content: string; inputMode: "text" | "voice" }>("POST", `/api/conversations/${conversationId}/retry`),
  watchers: () => call<{ watchers: WatchedPage[] }>("GET", "/api/watchers"),
  stopWatcher: (id: string) => call("DELETE", `/api/watchers/${id}`),
  routines: () => call<{ routines: Routine[]; examples: Omit<Routine, "id">[] }>("GET", "/api/routines"),
  saveRoutines: (routines: Routine[]) => call<{ routines: Routine[] }>("PUT", "/api/routines", { routines }),
  checkin: () => call<{ checkin: CheckIn }>("GET", "/api/settings/checkin"),
  saveCheckin: (c: CheckIn) => call<{ checkin: CheckIn }>("PUT", "/api/settings/checkin", c),
  calendar: () => call<{ calendar: { connected: boolean; lastSyncAt: string | null; error: string | null } }>("GET", "/api/calendar"),
  connectCalendar: (url: string) => call<{ calendar: { connected: boolean; lastSyncAt: string | null; error: string | null }; events: number }>("PUT", "/api/calendar", { url }),
  disconnectCalendar: () => call<{ calendar: { connected: boolean; lastSyncAt: string | null; error: string | null } }>("DELETE", "/api/calendar"),
  whatsNew: () => call<{ version: string; firstRun: boolean; sections: { version: string; title: string; items: string[] }[] }>("GET", "/api/whats-new"),
  whatsNewSeen: () => call("POST", "/api/whats-new/seen"),
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
  todos: () => call<{ todos: Todo[] }>("GET", "/api/todos"),
  addTodo: (text: string, dueDate?: string | null) => call<{ todo: Todo }>("POST", "/api/todos", { text, dueDate: dueDate || null }),
  updateTodo: (id: string, patch: { done?: boolean; text?: string; dueDate?: string | null }) => call<{ todo: Todo }>("PATCH", `/api/todos/${id}`, patch),
  deleteTodo: (id: string) => call("DELETE", `/api/todos/${id}`),
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
export async function sendMessage(conversationId: string, content: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal, inputMode: InputMode = "text", continueFrom?: string): Promise<void> {
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ content, deviceId: deviceId(), inputMode, ...(continueFrom ? { continueFrom } : {}) }),
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

export interface SearchStatus {
  configured: boolean;
  engine: "searxng" | "brave" | null;
  searxngUrl: string | null;
}

export interface Hud {
  system: { cpu: number; cpuThreads: number; cpuModel: string; ram: { used: number; total: number }; disk: { used: number; total: number } | null; pcUptimeSec: number; ultronUptimeSec: number };
  weather: { place: string; now: { conditions: string; temperature: string; feels_like: string; humidity: string; wind: string }; nextDays: { day: string; conditions: string; high: string; low: string; chance_of_rain?: string }[] } | null;
  homeLocationSet: boolean;
  agenda: { title: string; start: string; end: string; allDay: boolean; location?: string }[];
  calendarConnected: boolean;
  reminders: { id: string; text: string; dueAt: string }[];
  todos: { open: number; top: { id: string; text: string }[] };
  pendingApprovals: { id: string; tool: string; summary: string }[];
  watchers: number;
  feed: { id: string; title: string; source: string; url: string | null }[];
  memories: number;
  home: { lightsOn: string[]; lights: number; heating: { name: string; target: unknown; current: unknown } | null } | null;
}

export interface HomeStatus {
  connected: boolean;
  url: string | null;
  devices: number;
  error: string | null;
}
