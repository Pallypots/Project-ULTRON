import { newToolCallId, ProviderError, type ChatTurn, type ModelProvider, type ModelRequest, type ProviderEvent, type ToolSpec, withTurnContext } from "./types.ts";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

interface ChatChunk {
  message?: { content?: string; thinking?: string; tool_calls?: { function?: { name?: string; arguments?: Record<string, unknown> | string } }[] };
  done?: boolean;
  done_reason?: string;
  error?: string;
  // Timings Ollama reports on the final chunk (nanoseconds).
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** One fixed context size for every request (changing it makes Ollama reload the model). */
export const OLLAMA_NUM_CTX = Number(process.env.ULTRON_NUM_CTX ?? 8192);

const toOllamaMessages = (system: string, turns: ChatTurn[]) => [
  { role: "system", content: system },
  ...turns.map((t) =>
    t.role === "tool"
      ? { role: "tool", content: t.content, tool_name: t.name }
      : t.role === "assistant" && t.toolCalls?.length
        ? { role: "assistant", content: t.content, tool_calls: t.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) }
        : t.role === "user" && t.images?.length
          ? { role: "user", content: t.content, images: t.images }
          : { role: t.role, content: t.content },
  ),
];

/**
 * Local models via Ollama's native API (no API key, nothing leaves the PC).
 * Thinking is turned off/low for conversational speed; any thinking text is never shown as the answer.
 */
export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  readonly model: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch = (...a) => fetch(...a);

  constructor(opts: { model?: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    if (!opts.model) throw new ProviderError("Pick a local model in Settings → Language model → Local AI.", "config");
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
    if (opts.fetchImpl) this.fetchImpl = opts.fetchImpl;
  }

  private thinkSetting(deep?: boolean): boolean | "low" | "high" {
    // gpt-oss can't fully disable reasoning; others accept false. Deep thinking turns reasoning on (hidden from the answer).
    if (this.model.startsWith("gpt-oss")) return deep ? "high" : "low";
    return deep ? true : false;
  }

  /**
   * Loads the model ahead of time. With `prefix` (the real system prompt and tools), it also reads them once, so they
   * are already prefilled when the owner speaks: the first reply of the day is as quick as the tenth.
   */
  async warm(prefix?: { system: string; tools?: ToolSpec[] }): Promise<void> {
    const body = prefix
      ? {
          model: this.model,
          stream: false,
          keep_alive: -1,
          think: this.model.startsWith("gpt-oss") ? "low" : false,
          options: { num_ctx: OLLAMA_NUM_CTX, num_predict: 1 },
          messages: [{ role: "system", content: prefix.system }, { role: "user", content: "Hi" }],
          ...(prefix.tools?.length ? { tools: prefix.tools.map((t) => ({ type: "function", function: t })) } : {}),
        }
      : { model: this.model, keep_alive: -1, options: { num_ctx: OLLAMA_NUM_CTX } };
    await this.fetchImpl(`${this.baseUrl}${prefix ? "/api/chat" : "/api/generate"}`, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) }).catch(() => {});
  }

  /** What this model can do according to Ollama ("vision", "tools", "thinking"…), or null if unknown. */
  async capabilities(): Promise<string[] | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/show`, { method: "POST", body: JSON.stringify({ model: this.model }), signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const caps = ((await res.json()) as { capabilities?: string[] }).capabilities;
      return Array.isArray(caps) ? caps : null;
    } catch {
      return null;
    }
  }

  async *stream(req: ModelRequest): AsyncIterable<string> {
    for await (const e of this.run(req)) if (e.type === "text") yield e.text;
  }

  streamWithTools(req: ModelRequest & { tools: ToolSpec[] }): AsyncIterable<ProviderEvent> {
    return this.run(req, req.tools);
  }

  private async *run(req: ModelRequest, tools?: ToolSpec[]): AsyncIterable<ProviderEvent> {
    const body = (think: boolean | "low" | "high" | undefined) =>
      JSON.stringify({
        model: this.model,
        stream: true,
        // Stay loaded (a reload costs seconds), and always the same context size: a different size forces a reload,
        // and Ollama's small default silently cut long conversations.
        keep_alive: -1,
        options: { num_ctx: OLLAMA_NUM_CTX },
        messages: toOllamaMessages(req.system, withTurnContext(req.messages, req.turnContext)),
        ...(tools?.length ? { tools: tools.map((t) => ({ type: "function", function: t })) } : {}),
        ...(think === undefined ? {} : { think }),
      });

    let res = await this.post(body(this.thinkSetting(req.deep)), req.signal);
    // Older Ollama versions or non-thinking models may reject the `think` field: retry without it.
    if (res.status === 400) {
      const text = await res.text();
      if (/think/i.test(text)) res = await this.post(body(undefined), req.signal);
      else if (tools?.length && /tools?/i.test(text)) throw new ProviderError(`The local model "${this.model}" doesn't support actions (tool use). Pick a model that does, e.g. qwen3 or gpt-oss.`, "bad_request");
      else throw new ProviderError(`The local model rejected the request: ${parseError(text)}`, "bad_request");
    }
    if (res.status === 404) throw new ProviderError(`The local model "${this.model}" isn't downloaded. Download it in Settings → Language model → Local AI.`, "bad_request");
    if (!res.ok || !res.body) throw new ProviderError(`Local AI error (${res.status}): ${parseError(await res.text())}`, "unavailable");

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let inThinkTag = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const chunk = JSON.parse(line) as ChatChunk;
        if (chunk.error) throw new ProviderError(`Local AI error: ${chunk.error}`, "unavailable");
        for (const tc of chunk.message?.tool_calls ?? []) {
          const name = tc.function?.name;
          if (!name) continue;
          const raw = tc.function?.arguments ?? {};
          let args: Record<string, unknown> = {};
          try {
            args = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : raw;
          } catch {
            args = {};
          }
          yield { type: "tool_call", call: { id: newToolCallId(), name, args } };
        }
        let text = chunk.message?.content ?? "";
        // Some model templates inline their reasoning as <think>…</think>; never speak it.
        if (text) {
          let out = "";
          for (const part of text.split(/(<\/?think>)/)) {
            if (part === "<think>") inThinkTag = true;
            else if (part === "</think>") inThinkTag = false;
            else if (!inThinkTag) out += part;
          }
          text = out;
        }
        if (text) yield { type: "text", text };
        if (chunk.done)
          req.onStats?.({
            loadMs: Math.round((chunk.load_duration ?? 0) / 1e6),
            promptTokens: chunk.prompt_eval_count ?? 0,
            promptMs: Math.round((chunk.prompt_eval_duration ?? 0) / 1e6),
            outputTokens: chunk.eval_count ?? 0,
            outputMs: Math.round((chunk.eval_duration ?? 0) / 1e6),
          });
        if (chunk.done && chunk.done_reason === "length") yield { type: "text", text: "\n\n[Response truncated at the length limit.]" };
      }
    }
  }

  private async post(body: string, signal?: AbortSignal): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body, signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      throw new ProviderError("Local AI (Ollama) isn't running. Start the Ollama app, or install it from ollama.com/download.", "unavailable");
    }
  }
}

function parseError(text: string): string {
  try {
    return (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    return text.slice(0, 300);
  }
}
