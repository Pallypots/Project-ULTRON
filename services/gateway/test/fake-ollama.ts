// A small stand-in for the Ollama HTTP API, so local-AI features are tested without a real model.
import { createServer, type Server } from "node:http";

export interface FakeOllama {
  url: string;
  installed: string[];
  requests: { path: string; body: any }[];
  /** Tokens streamed for chat; may include thinking or <think> content to test filtering. */
  chatScript: { content?: string; thinking?: string }[];
  rejectThink: boolean;
  close(): Promise<void>;
}

export async function startFakeOllama(): Promise<FakeOllama> {
  const state: Omit<FakeOllama, "url" | "close"> = {
    installed: ["gemma4:e2b"],
    requests: [],
    chatScript: [{ thinking: "hmm, let me think" }, { content: "<think>secret plan</think>" }, { content: "Hello " }, { content: "from local." }],
    rejectThink: false,
  };
  const server: Server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    state.requests.push({ path: req.url ?? "", body });
    const line = (o: unknown) => res.write(JSON.stringify(o) + "\n");
    if (req.url === "/api/version") return res.end(JSON.stringify({ version: "0.99.0-fake" }));
    if (req.url === "/api/tags")
      return res.end(JSON.stringify({ models: state.installed.map((name) => ({ name, model: name, size: 2_000_000_000, details: { parameter_size: "2B", family: name.split(":")[0] } })) }));
    if (req.url === "/api/pull") {
      if (String(body.model).includes("nope")) {
        res.writeHead(200);
        line({ status: "pulling manifest" });
        line({ error: "pull model manifest: file does not exist" });
        return res.end();
      }
      res.writeHead(200);
      line({ status: "pulling manifest" });
      for (let i = 1; i <= 4; i++) {
        line({ status: "pulling abc", digest: "sha256:abc", total: 4000, completed: i * 1000 });
        await new Promise((r) => setTimeout(r, 30));
      }
      line({ status: "verifying sha256 digest" });
      line({ status: "success" });
      state.installed.push(body.model);
      return res.end();
    }
    if (req.url === "/api/chat") {
      if (!state.installed.includes(body.model)) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: `model '${body.model}' not found` }));
      }
      if (state.rejectThink && "think" in body) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: `"${body.model}" does not support thinking` }));
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      for (const m of state.chatScript) line({ model: body.model, message: { role: "assistant", ...m }, done: false });
      line({ model: body.model, message: { role: "assistant", content: "" }, done: true, done_reason: "stop" });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return Object.assign(state, { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) }) as FakeOllama;
}
