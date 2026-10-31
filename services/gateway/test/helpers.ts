import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatEvent } from "@ultron/schemas";
import { buildGateway, type Gateway } from "../src/app.ts";

export const tmpDataDir = () => mkdtempSync(join(tmpdir(), "ultron-gw-"));

/** A folder ULTRON may index. On Windows the system temp folder is under AppData, which ULTRON refuses on purpose. */
export function indexableFolder(prefix: string): string {
  const base = process.platform === "win32" ? join(import.meta.dirname, "..", "..", "..", ".test-tmp") : tmpdir();
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

// Tests don't download the real embedding model (each gateway has its own temp data folder); see embeddings tests.
process.env.ULTRON_EMBEDDINGS ??= "off";
process.env.ULTRON_CHECKIN ??= "off"; // tests call the morning check-in directly
process.env.ULTRON_WATCHERS ??= "off"; // and the page watcher

export async function startGateway(dataDir = tmpDataDir()) {
  const gw = await buildGateway({ dataDir, uiDir: null, mockDelayMs: 0, logLevel: "info" });
  const auth = { authorization: `Bearer ${gw.token}`, host: "localhost:7477" };
  const api = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
    const res = await gw.app.inject({ method, url, headers: auth, payload: payload as any });
    return { status: res.statusCode, body: res.headers["content-type"]?.includes("json") ? res.json() : res.body };
  };
  const chat = async (conversationId: string, content: string): Promise<ChatEvent[]> => {
    const res = await gw.app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: auth, payload: { content } });
    if (res.statusCode !== 200) throw new Error(`chat failed ${res.statusCode}: ${res.body}`);
    return res.body
      .split("\n\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as ChatEvent);
  };
  const newConversation = async () => (await api("POST", "/api/conversations")).body.conversation.id as string;
  return { gw, api, chat, newConversation, dataDir, close: () => gw.app.close() };
}

export const replyText = (events: ChatEvent[]) => events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
export type { Gateway };

/** Records a real-world result for CI: a later workflow step turns these into GitHub notices (see scripts/ci-notes.mjs). */
export function ciNote(title: string, message: string) {
  console.log(`[ci-note] ${title}: ${message}`);
  if (process.env.GITHUB_ACTIONS && process.env.RUNNER_TEMP)
    appendFileSync(join(process.env.RUNNER_TEMP, "ultron-ci-notes.jsonl"), JSON.stringify({ title: `${title} (${process.platform})`, message }) + "\n");
}

