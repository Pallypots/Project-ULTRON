import { ProviderError, type ModelProvider, type ModelRequest } from "./types.ts";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

interface ChatChunk {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
  error?: string;
}

/**
 * Local models via Ollama's native API (no API key, nothing leaves the PC).
 * Thinking is turned off/low for conversational speed; any thinking text is never shown as the answer.
 */
export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  readonly model: string;
  private baseUrl: string;

  constructor(opts: { model?: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    if (!opts.model) throw new ProviderError("Pick a local model in Settings → Language model → Local AI.", "config");
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
    if (opts.fetchImpl) this.fetchImpl = opts.fetchImpl;
  }

  private fetchImpl: typeof fetch = (...a) => fetch(...a);

  private thinkSetting(): boolean | "low" | undefined {
    // gpt-oss can't fully disable reasoning; others accept false.
    return this.model.startsWith("gpt-oss") ? "low" : false;
  }

  async *stream(req: ModelRequest): AsyncIterable<string> {
    const body = (think: boolean | "low" | undefined) =>
      JSON.stringify({
        model: this.model,
        stream: true,
        keep_alive: "30m",
        messages: [{ role: "system", content: req.system }, ...req.messages],
        ...(think === undefined ? {} : { think }),
      });

    let res = await this.post(body(this.thinkSetting()), req.signal);
    // Older Ollama versions or non-thinking models may reject the `think` field: retry without it.
    if (res.status === 400) {
      const text = await res.text();
      if (/think/i.test(text)) res = await this.post(body(undefined), req.signal);
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
        if (text) yield text;
        if (chunk.done && chunk.done_reason === "length") yield "\n\n[Response truncated at the length limit.]";
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
