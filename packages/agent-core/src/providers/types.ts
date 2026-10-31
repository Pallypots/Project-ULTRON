import type { Capability, Memory } from "@ultron/schemas";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatTurn =
  /** `images`: base64 JPEG/PNG the owner chose to share this turn (e.g. a screenshot); only sent to the brain, never stored. */
  | { role: "user"; content: string; images?: string[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; name: string };

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ProviderEvent = { type: "text"; text: string } | { type: "tool_call"; call: ToolCall };

export interface ModelRequest {
  system: string;
  messages: ChatTurn[];
  /** Retrieved memories, also embedded in `system`; exposed so offline providers can use them. */
  memories: Memory[];
  /** Live capability state, also embedded in `system`; lets offline providers answer "what can you do?". */
  capabilities?: Capability[];
  signal?: AbortSignal;
  /** The owner asked for careful reasoning ("think hard about…"): let models that can reason do so, at the cost of speed. */
  deep?: boolean;
}

/** Every LLM backend implements this. Roles (fast chat, deep reasoning, vision, embeddings) map onto instances. */
export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  stream(req: ModelRequest): AsyncIterable<string>;
  /** Providers that can call tools implement this; text and tool calls arrive as events. */
  streamWithTools?(req: ModelRequest & { tools: ToolSpec[] }): AsyncIterable<ProviderEvent>;
}

let callSeq = 0;
export const newToolCallId = () => `call_${Date.now().toString(36)}_${(callSeq++).toString(36)}`;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: "auth" | "rate_limit" | "unavailable" | "bad_request" | "refused" | "config" | "unknown",
  ) {
    super(message);
  }
}
