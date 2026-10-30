import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type ModelProvider, type ModelRequest } from "./types.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(opts: { apiKey: string; model?: string; baseUrl?: string }) {
    this.model = opts.model || DEFAULT_ANTHROPIC_MODEL;
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl || undefined, maxRetries: 2 });
  }

  async *stream(req: ModelRequest): AsyncIterable<string> {
    try {
      // Server-side fallbacks re-run a policy-declined request on a fallback model inside the same call.
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 16000,
          system: req.system,
          messages: req.messages,
          output_config: { effort: "low" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        } as any,
        { signal: req.signal },
      );
      for await (const event of stream as AsyncIterable<any>) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text as string;
      }
      const final = (await stream.finalMessage()) as { stop_reason?: string };
      if (final.stop_reason === "refusal") throw new ProviderError("The model declined to answer this request.", "refused");
      if (final.stop_reason === "max_tokens") yield "\n\n[Response truncated at the length limit.]";
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
