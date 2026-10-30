import OpenAI from "openai";
import { ProviderError, type ModelProvider, type ModelRequest } from "./types.ts";

/**
 * OpenAI and any OpenAI-compatible server (Ollama, LM Studio, llama.cpp) via baseUrl.
 * No default model: the owner picks one, because availability differs per account and per local install.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = "openai";
  readonly model: string;
  private client: OpenAI;

  constructor(opts: { apiKey?: string; model?: string; baseUrl?: string }) {
    if (!opts.model) throw new ProviderError("Choose a model name for the OpenAI-compatible provider in Settings.", "config");
    this.model = opts.model;
    this.client = new OpenAI({ apiKey: opts.apiKey || "not-needed-for-local", baseURL: opts.baseUrl || undefined, maxRetries: 2 });
  }

  async *stream(req: ModelRequest): AsyncIterable<string> {
    try {
      const stream = await this.client.chat.completions.create(
        { model: this.model, stream: true, messages: [{ role: "system", content: req.system }, ...req.messages] },
        { signal: req.signal },
      );
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield text;
      }
    } catch (err) {
      if (err instanceof OpenAI.APIUserAbortError) throw err;
      if (err instanceof OpenAI.AuthenticationError) throw new ProviderError("The OpenAI-compatible server rejected the API key.", "auth");
      if (err instanceof OpenAI.RateLimitError) throw new ProviderError("The model server is rate-limiting requests.", "rate_limit");
      if (err instanceof OpenAI.NotFoundError) throw new ProviderError(`Model "${this.model}" was not found on the server.`, "bad_request");
      if (err instanceof OpenAI.APIConnectionError) throw new ProviderError("Couldn't reach the model server. Is it running?", "unavailable");
      if (err instanceof OpenAI.APIError) throw new ProviderError(`Model server error: ${err.message}`, "unavailable");
      throw err;
    }
  }
}
