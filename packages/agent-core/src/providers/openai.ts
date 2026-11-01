import OpenAI from "openai";
import { newToolCallId, ProviderError, type ChatTurn, type ModelProvider, type ModelRequest, type ProviderEvent, type ToolSpec, withTurnContext } from "./types.ts";

const toOpenAIMessages = (system: string, turns: ChatTurn[]): OpenAI.ChatCompletionMessageParam[] => [
  { role: "system", content: system },
  ...turns.map((t): OpenAI.ChatCompletionMessageParam =>
    t.role === "tool"
      ? { role: "tool", tool_call_id: t.toolCallId, content: t.content }
      : t.role === "assistant"
        ? {
            role: "assistant",
            content: t.content,
            ...(t.toolCalls?.length ? { tool_calls: t.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
          }
        : t.images?.length
          ? {
              role: "user",
              content: [
                ...t.images.map((d) => ({ type: "image_url" as const, image_url: { url: `data:${d.startsWith("iVBOR") ? "image/png" : "image/jpeg"};base64,${d}` } })),
                { type: "text" as const, text: t.content },
              ],
            }
          : { role: "user", content: t.content },
  ),
];

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
    for await (const e of this.run(req)) if (e.type === "text") yield e.text;
  }

  streamWithTools(req: ModelRequest & { tools: ToolSpec[] }): AsyncIterable<ProviderEvent> {
    return this.run(req, req.tools);
  }

  private async *run(req: ModelRequest, tools?: ToolSpec[]): AsyncIterable<ProviderEvent> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          stream: true,
          messages: toOpenAIMessages(req.system, withTurnContext(req.messages, req.turnContext)),
          ...(tools?.length ? { tools: tools.map((t) => ({ type: "function" as const, function: t })) } : {}),
        },
        { signal: req.signal },
      );
      const pending = new Map<number, { id: string; name: string; args: string }>();
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) yield { type: "text", text: delta.content };
        for (const tc of delta?.tool_calls ?? []) {
          const cur = pending.get(tc.index) ?? { id: tc.id ?? newToolCallId(), name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          pending.set(tc.index, cur);
        }
      }
      for (const p of pending.values()) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(p.args || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        if (p.name) yield { type: "tool_call", call: { id: p.id, name: p.name, args } };
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
