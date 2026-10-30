import type { AuditEvent, Capability, ChatEvent, Conversation, InputMode, Memory, MemoryKind, Message, TranscribeResult, VoiceStatus } from "@ultron/schemas";

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
  providerProblem: string | null;
  activeReplies: number;
  counts: { conversations: number; memories: number };
  persona: { name: string };
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
  voiceStatus: () => call<VoiceStatus>("GET", "/api/voice/status"),
  saveVoiceSettings: (s: { engine: VoiceStatus["engine"]; model?: string }) => call<VoiceStatus>("PUT", "/api/voice/settings", s),
  prepareVoice: () => call<VoiceStatus>("POST", "/api/voice/prepare"),
};

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
