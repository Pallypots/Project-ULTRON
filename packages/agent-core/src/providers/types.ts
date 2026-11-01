import type { Capability, Memory } from "@ultron/schemas";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatTurn =
  /** `images`: base64 JPEG/PNG the owner chose to share this turn (e.g. a screenshot); only sent to the brain, never stored. */
  /** `context`: the context block this message was first sent with (kept identical so a local model can reuse its reading). */
  | { role: "user"; content: string; images?: string[]; context?: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; name: string };

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ProviderEvent = { type: "text"; text: string } | { type: "tool_call"; call: ToolCall };

/**
 * Attaches this turn's context (time, memories, agenda…) to the latest owner message, so the system prompt itself
 * never changes between turns and a local model can reuse what it already read.
 */
export const CONTEXT_OPEN = "[Context for this reply, from ULTRON, not the owner. Use it; never repeat it.]";
export const CONTEXT_CLOSE = "[End of context. The owner's message follows.]";

export function withTurnContext(turns: ChatTurn[], context: string | undefined): ChatTurn[] {
  let last = turns.length - 1;
  while (last >= 0 && turns[last]!.role !== "user") last--;
  // Earlier messages keep the exact context they were first sent with: a local model can only reuse what it already
  // read when each request just adds to the end of the last one (changing an earlier message made it re-read everything).
  // Before the owner's words (models continue whatever comes last, so a trailing block got echoed back).
  const wrap = (c: string, content: string) => `${CONTEXT_OPEN}\n${c}\n${CONTEXT_CLOSE}\n\n${content}`;
  return turns.map((t, i) => {
    if (t.role !== "user") return t;
    const c = i === last ? context : t.context;
    const { context: _drop, ...rest } = t;
    return c ? { ...rest, content: wrap(c, t.content) } : rest;
  });
}

export interface ModelRequest {
  /** This turn's changing context; providers attach it to the latest owner message (see withTurnContext). */
  turnContext?: string;
  /** Called with the local model's own timings when a call finishes (diagnostics; local providers only). */
  onStats?: (s: { loadMs: number; promptTokens: number; promptMs: number; outputTokens: number; outputMs: number }) => void;
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
