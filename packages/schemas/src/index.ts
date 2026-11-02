// Shared typed contracts between the gateway and every ULTRON client.
import { z } from "zod";

export const Role = z.enum(["user", "assistant", "system"]);
export type Role = z.infer<typeof Role>;

export const MessageStatus = z.enum(["streaming", "complete", "error", "cancelled"]);
export type MessageStatus = z.infer<typeof MessageStatus>;

export const InputMode = z.enum(["text", "voice"]);
export type InputMode = z.infer<typeof InputMode>;

export const ToolEvent = z.object({
  executionId: z.string(),
  tool: z.string(),
  summary: z.string(),
  status: z.string(),
  risk: z.number(),
  preview: z.string().optional(),
});
export type ToolEvent = z.infer<typeof ToolEvent>;

export const Message = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: Role,
  content: z.string(),
  status: MessageStatus,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  memoryIds: z.array(z.string()),
  sourceDeviceId: z.string().nullable(),
  inputMode: InputMode,
  toolEvents: z.array(ToolEvent),
  createdAt: z.string(),
});
export type Message = z.infer<typeof Message>;

export const Conversation = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** ULTRON's own one-or-two-sentence note of what was discussed, once the conversation went quiet. */
  summary: z.string().nullable().optional(),
});
export type Conversation = z.infer<typeof Conversation>;

export const MemoryKind = z.enum(["fact", "preference", "project", "note"]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const Sensitivity = z.enum(["normal", "personal", "sensitive"]);
export type Sensitivity = z.infer<typeof Sensitivity>;

export const Memory = z.object({
  id: z.string(),
  kind: MemoryKind,
  content: z.string(),
  source: z.enum(["chat", "manual", "import"]),
  sourceConversationId: z.string().nullable(),
  sourceMessageId: z.string().nullable(),
  confirmed: z.boolean(),
  pinned: z.boolean(),
  confidence: z.number().min(0).max(1),
  sensitivity: Sensitivity,
  reviewAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Memory = z.infer<typeof Memory>;

export const MemoryCreate = z.object({
  content: z.string().trim().min(1).max(2000),
  kind: MemoryKind.default("note"),
  pinned: z.boolean().default(false),
  sensitivity: Sensitivity.default("normal"),
});
export type MemoryCreate = z.infer<typeof MemoryCreate>;

export const MemoryPatch = z
  .object({
    content: z.string().trim().min(1).max(2000),
    kind: MemoryKind,
    pinned: z.boolean(),
    sensitivity: Sensitivity,
  })
  .partial();
export type MemoryPatch = z.infer<typeof MemoryPatch>;

export const SendMessage = z.object({
  content: z.string().trim().min(1).max(20000),
  deviceId: z.string().max(100).optional(),
  inputMode: InputMode.default("text"),
  /** Continue after the owner approved an action: its result is given to the brain with this message. */
  continueFrom: z.string().max(64).optional(),
  /** One camera photo the owner just took for this message (base64 JPEG, ~2 MB max). Never stored. */
  image: z.string().max(2_800_000).regex(/^\/9j\/[A-Za-z0-9+/=]+$/, "must be a JPEG photo").optional(),
  /** Spoken within 8 s of ULTRON finishing speaking: the owner's direct reaction to what he just said. */
  replyToLast: z.boolean().optional(),
});

export const ProviderId = z.enum(["mock", "ollama", "anthropic", "openai"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const ProviderSettingsUpdate = z.object({
  provider: ProviderId,
  model: z.string().trim().max(200).optional(),
  baseUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  apiKey: z.string().trim().max(500).optional(),
});
export type ProviderSettingsUpdate = z.infer<typeof ProviderSettingsUpdate>;

/** Server-sent events emitted while ULTRON answers. */
export type ChatEvent =
  | { type: "start"; userMessage: Message; assistantMessageId: string; provider: string; model: string }
  | { type: "memories"; memories: Pick<Memory, "id" | "content" | "kind" | "createdAt">[] }
  | { type: "memory_saved"; memory: Memory }
  | { type: "memory_forgotten"; memory: Pick<Memory, "id" | "content"> }
  | { type: "memory_blocked"; reason: string }
  | { type: "tool"; event: ToolEvent }
  | { type: "brain_changed"; provider: string; model: string; where: "local" | "cloud" | "test" }
  | { type: "delta"; text: string }
  | { type: "done"; message: Message }
  | { type: "error"; message: string; code: string };

export const SttEngineId = z.enum(["local", "openai", "mock"]);

export const VoiceSettingsUpdate = z.object({
  engine: SttEngineId,
  model: z.string().trim().max(200).optional(),
});

export interface VoiceStatus {
  engine: z.infer<typeof SttEngineId>;
  model: string;
  state: "ready" | "not_loaded" | "loading" | "error" | "not_configured";
  detail: string;
  progress?: number;
  privacy: string;
  maxSeconds: number;
}

export interface TranscribeResult {
  text: string;
  engine: string;
  model: string;
  audioSeconds: number;
  elapsedMs: number;
}

export const TtsSettingsUpdate = z.object({
  engine: z.enum(["local", "browser", "mock"]),
  voice: z.string().trim().max(50).optional(),
  speed: z.number().min(0.5).max(2).optional(),
});

export interface TtsStatusResponse {
  engine: "local" | "browser" | "mock";
  voice: string;
  speed: number;
  voices: { id: string; name: string; accent: string; gender: string; quality: string }[];
  state: "ready" | "not_loaded" | "loading" | "error";
  detail: string;
  progress?: number;
}

export const Capability = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["enabled", "disabled", "not_configured", "not_implemented"]),
  detail: z.string(),
});
export type Capability = z.infer<typeof Capability>;

export const AuditEvent = z.object({
  id: z.string(),
  action: z.string(),
  actor: z.string(),
  target: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
