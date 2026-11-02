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
        options: { num_ctx: OLLAMA_NUM_CTX, ...(req.maxTokens ? { num_predict: req.maxTokens } : {}) },
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
    let carry = "";
    const leaks = new LeakedToolCalls(tools?.map((t) => t.name) ?? []);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let chunk: ChatChunk;
        try {
          chunk = JSON.parse(line) as ChatChunk;
        } catch {
          continue; // one garbled line shouldn't end the whole reply
        }
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
        // Some model templates inline their reasoning as <think>…</think>; never speak it. A tag can arrive split
        // across chunks ("<thi" + "nk>"), so a possible partial tag at the end is held back until the next chunk.
        let text = carry + (chunk.message?.content ?? "");
        carry = "";
        if (text) {
          const partial = /<\/?t?h?i?n?k?$/.exec(text);
          if (partial && partial[0].length > 0 && !chunk.done) {
            carry = partial[0];
            text = text.slice(0, -carry.length);
          }
          let out = "";
          for (const part of text.split(/(<\/?think>)/)) {
            if (part === "<think>") inThinkTag = true;
            else if (part === "</think>") inThinkTag = false;
            else if (!inThinkTag) out += part;
          }
          text = out;
        }
        // A small model sometimes writes its tool call out as text instead of a real call: turn it into one, never show it.
        const sorted = leaks.push(text, Boolean(chunk.done));
        if (sorted.text) yield { type: "text", text: sorted.text };
        for (const call of sorted.calls) yield { type: "tool_call", call: { id: newToolCallId(), ...call } };
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

/**
 * Spots tool calls a model wrote as plain text (Gemma's "<|tool_call>call:name{a:<|"|>x<|"|>}<tool_call|>",
 * or "<tool_call>{json}</tool_call>") in a stream of text. Text before and after passes through; the call itself never does.
 */
const MARKERS = ["<|tool_call>", "<tool_call>", "<|tool_response>", "<tool_response>"];

export class LeakedToolCalls {
  private held = "";
  /** After a written-out call the model often invents the tool's answer too ("<|tool_response>…"): ULTRON runs the real tool instead. */
  private muted = false;
  constructor(private names: string[]) {}

  push(text: string, done: boolean): { text: string; calls: { name: string; args: Record<string, unknown> }[] } {
    let s = this.held + text;
    this.held = "";
    let out = "";
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    if (this.muted) return { text: "", calls };
    for (;;) {
      const resp = /<\|tool_response>|<tool_response>/.exec(s);
      const m0 = /<\|tool_call>|<tool_call>/.exec(s);
      if (resp && (!m0 || resp.index < m0.index)) {
        this.muted = true;
        return { text: out + s.slice(0, resp.index), calls };
      }
      const m = /<\|tool_call>|<tool_call>/.exec(s);
      if (!m) break;
      out += s.slice(0, m.index);
      const close = m[0] === "<tool_call>" ? "</tool_call>" : "<tool_call|>";
      const end = s.indexOf(close, m.index);
      if (end < 0) {
        if (done) s = ""; // never finished: drop it rather than show raw tokens
        else this.held = s.slice(m.index);
        return { text: out, calls };
      }
      const call = this.parse(s.slice(m.index + m[0].length, end));
      if (call) calls.push(call);
      s = s.slice(end + close.length);
    }
    // Gemma sometimes drops the markers and writes just `get_weather{place:<|"|>Paris<|"|>}`: same treatment.
    for (;;) {
      if (!this.names.length) break;
      const bare = new RegExp(`(?:call:)?\\b(?:${this.names.map((n) => n.replace(/[^\w]/g, "")).join("|")})\\s*[{(]`).exec(s);
      if (!bare) break;
      const open = bare[0].at(-1)!;
      const shut = open === "{" ? "}" : ")";
      let depth = 0;
      let end = -1;
      for (let i = bare.index + bare[0].length - 1; i < s.length; i++) {
        if (s[i] === open) depth++;
        else if (s[i] === shut && --depth === 0) {
          end = i;
          break;
        }
      }
      out += s.slice(0, bare.index);
      if (end < 0) {
        if (!done) this.held = s.slice(bare.index);
        return { text: out, calls };
      }
      const call = this.parse(s.slice(bare.index, end + 1));
      if (call) calls.push(call);
      else out += s.slice(bare.index, end + 1); // not a real call after all: show it as written
      s = s.slice(end + 1);
    }
    // A marker or a tool name might be arriving split across chunks: hold a possible start back.
    if (!done) {
      const word = /[A-Za-z_]{3,}$/.exec(s);
      // (A whole tool name is held too: its "{" may be in the next piece.)
      if (word && this.names.some((n) => n.startsWith(word[0]))) {
        this.held = word[0] + this.held;
        s = s.slice(0, word.index);
      }
      const lt = s.lastIndexOf("<");
      const tail = lt >= 0 ? s.slice(lt) : "";
      if (tail && MARKERS.some((m) => m.startsWith(tail))) {
        this.held = tail;
        s = s.slice(0, lt);
      }
    }
    return { text: out + s, calls };
  }

  private parse(body: string): { name: string; args: Record<string, unknown> } | null {
    body = body.trim();
    try {
      if (body.startsWith("{")) {
        const j = JSON.parse(body) as { name?: string; arguments?: Record<string, unknown> };
        return j.name && this.names.includes(j.name) ? { name: j.name, args: j.arguments ?? {} } : null;
      }
      const m = /^(?:call:)?([\w.-]+)\s*([{(][\s\S]*[})])?$/.exec(body);
      if (!m || !this.names.includes(m[1]!)) return null;
      if (!m[2]) return { name: m[1]!, args: {} };
      // Gemma's forms: name{key:<|"|>v<|"|>} or name(key: 'v') / name(key="v"): unquoted keys, odd string quotes.
      const strings: string[] = [];
      let j = `{${m[2].slice(1, -1)}}`.replace(/<\|"\|>([\s\S]*?)<\|"\|>|'([^']*)'|"([^"]*)"/g, (_, a?: string, b?: string, c?: string) => `\u0000${strings.push(a ?? b ?? c ?? "") - 1}\u0000`);
      j = j.replace(/([{,]\s*)([A-Za-z_]\w*)\s*[:=]/g, '$1"$2":');
      j = j.replace(/\u0000(\d+)\u0000/g, (_, i: string) => JSON.stringify(strings[Number(i)]));
      return { name: m[1]!, args: JSON.parse(j) as Record<string, unknown> };
    } catch {
      return null;
    }
  }
}
