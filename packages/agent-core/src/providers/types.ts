import type { Memory } from "@ultron/schemas";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  system: string;
  messages: ChatTurn[];
  /** Retrieved memories, also embedded in `system`; exposed so offline providers can use them. */
  memories: Memory[];
  signal?: AbortSignal;
}

/** Every LLM backend implements this. Roles (fast chat, deep reasoning, vision, embeddings) map onto instances. */
export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  stream(req: ModelRequest): AsyncIterable<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: "auth" | "rate_limit" | "unavailable" | "bad_request" | "refused" | "config" | "unknown",
  ) {
    super(message);
  }
}
