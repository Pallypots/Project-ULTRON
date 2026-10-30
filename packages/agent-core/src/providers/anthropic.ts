import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type ChatTurn, type ModelProvider, type ModelRequest, type ProviderEvent, type ToolSpec } from "./types.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Claude expects tool results as user-turn blocks; consecutive results are merged into one user message. */
function toAnthropicMessages(turns: ChatTurn[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const t of turns) {
    if (t.role === "tool") {
      const block: Anthropic.ToolResultBlockParam = { type: "tool_result", tool_use_id: t.toolCallId, content: t.content };
      const last = out.at(-1);
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => (b as { type: string }).type === "tool_result")) (last.content as Anthropic.ToolResultBlockParam[]).push(block);
      else out.push({ role: "user", content: [block] });
    } else if (t.role === "assistant" && t.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: [...(t.content ? [{ type: "text" as const, text: t.content }] : []), ...t.toolCalls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.args }))],
      });
    } else out.push({ role: t.role, content: t.content });
  }
  return out;
}

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(opts: { apiKey: string; model?: string; baseUrl?: string }) {
    this.model = opts.model || DEFAULT_ANTHROPIC_MODEL;
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl || undefined, maxRetries: 2 });
  }

  async *stream(req: ModelRequest): AsyncIterable<string> {
    for await (const e of this.run(req)) if (e.type === "text") yield e.text;
  }

  streamWithTools(req: ModelRequest & { tools: ToolSpec[] }): AsyncIterable<ProviderEvent> {
    return this.run(req, req.tools);
  }

  private async *run(req: ModelRequest, tools?: ToolSpec[]): AsyncIterable<ProviderEvent> {
    try {
      // Server-side fallbacks re-run a policy-declined request on a fallback model inside the same call.
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 16000,
          system: req.system,
          messages: toAnthropicMessages(req.messages),
          output_config: { effort: "low" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          ...(tools?.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters, eager_input_streaming: true })) } : {}),
        } as any,
        { signal: req.signal },
      );
      for await (const event of stream as AsyncIterable<any>) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield { type: "text", text: event.delta.text as string };
      }
      const final = (await stream.finalMessage()) as { stop_reason?: string; content: { type: string; id?: string; name?: string; input?: unknown }[] };
      if (final.stop_reason === "refusal") throw new ProviderError("The model declined to answer this request.", "refused");
      if (final.stop_reason === "max_tokens") {
        yield { type: "text", text: "\n\n[Response truncated at the length limit.]" };
        return; // a truncated tool call may be incomplete, so never run it
      }
      for (const b of final.content) {
        if (b.type === "tool_use" && b.id && b.name) yield { type: "tool_call", call: { id: b.id, name: b.name, args: (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown> } };
      }
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}

function mapAnthropicError(err: unknown): Error {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("Claude rejected the API key. Check it in Settings.", "auth");
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("Claude is rate-limiting requests. Try again shortly.", "rate_limit");
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError)
    return new ProviderError(`Claude rejected the request: ${err.message}`, "bad_request");
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("Couldn't reach Claude. Check your internet connection.", "unavailable");
  if (err instanceof Anthropic.APIError) return new ProviderError(`Claude returned an error: ${err.message}`, "unavailable");
  return new ProviderError((err as Error)?.message ?? "Unknown Claude error", "unknown");
}
