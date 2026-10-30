import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatEvent } from "@ultron/schemas";
import { buildGateway, type Gateway } from "../src/app.ts";

export const tmpDataDir = () => mkdtempSync(join(tmpdir(), "ultron-gw-"));

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
