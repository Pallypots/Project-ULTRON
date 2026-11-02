// Phase 3.5: which small local brain suits ULTRON best on an ordinary CPU? Each candidate goes through ULTRON's real
// pipeline (same instructions, same tools, same questions) and is scored on getting the job done and on speed.
// Informational: records numbers only. Runs with ULTRON_TEST_OLLAMA=1 and ULTRON_TEST_BRAIN_AB=1 (CI, Linux).
import { describe, expect, it } from "vitest";
import { ciNote, replyText, startGateway } from "./helpers.ts";

const enabled = process.env.ULTRON_TEST_OLLAMA === "1" && process.env.ULTRON_TEST_BRAIN_AB === "1";
const OLLAMA = "http://127.0.0.1:11434";
const MODELS = (process.env.ULTRON_BRAIN_AB_MODELS ?? "gemma4:e2b,qwen3:1.7b,llama3.2:3b,gemma3:1b,granite4:micro").split(",");

type Case = { say: string; ok: (text: string, tools: string[]) => boolean; what: string };
const CASES: Case[] = [
  { what: "maths with the calculator", say: "I'm buying a $1299 laptop with 15% off, plus $4.99 shipping. What do I pay in total?", ok: (t) => /1,?109\.14/.test(t) },
  { what: "multiplication", say: "What's 17 times 23?", ok: (t) => /\b391\b/.test(t) },
  { what: "weather tool", say: "Should I take an umbrella in Paris tomorrow?", ok: (_t, tools) => tools.some((x) => x.startsWith("get_weather")) },
  { what: "general knowledge", say: "Who painted the Mona Lisa?", ok: (t) => /leonardo|da vinci/i.test(t) },
  { what: "small talk, no tools, short", say: "Hey, I had a rough day at work.", ok: (t, tools) => tools.length === 0 && t.length > 10 && t.length < 500 },
  { what: "opens a website only with approval", say: "Please open youtube.com for me.", ok: (_t, tools) => tools.some((x) => x === "open_website:awaiting_approval") },
];

async function pull(model: string): Promise<string | null> {
  const res = await fetch(`${OLLAMA}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: false }) });
  const body = await res.text();
  return res.ok && !/error/i.test(body) ? null : body.slice(0, 120);
}

describe.skipIf(!enabled)("local brain candidates through ULTRON's real pipeline", () => {
  it("scores each model on the same everyday requests", async () => {
    process.env.ULTRON_ACTIONS_DRY_RUN = "1";
    const g = await startGateway();
    const lines: string[] = [];
    try {
      for (const model of MODELS) {
        const failed = await pull(model);
        if (failed) {
          lines.push(`${model}: not available (${failed})`);
          continue;
        }
        g.gw.stores.preferences.set("provider", { provider: "ollama", model, baseUrl: OLLAMA });
        await g.chat(await g.newConversation(), "Hello."); // load the model, so loading isn't counted against it
        let passed = 0;
        const misses: string[] = [];
        const firstWords: number[] = [];
        const wholes: number[] = [];
        for (const c of CASES) {
          const t = Date.now();
          const events = await g.chat(await g.newConversation(), c.say);
          wholes.push(Date.now() - t);
          const text = replyText(events).replace(/\s+/g, " ");
          const tools = events.filter((e) => e.type === "tool").map((e: any) => `${e.event.tool}:${e.event.status}`);
          const { recent } = (await g.api("GET", "/api/perf")).body as { recent: { marks: Record<string, number> }[] };
          if (recent[0]?.marks.first_token) firstWords.push(recent[0].marks.first_token);
          if (c.ok(text, tools)) passed++;
          else misses.push(`${c.what} ("${text.slice(0, 70)}" ${JSON.stringify(tools)})`);
        }
        const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : "–");
        lines.push(`${model}: ${passed}/${CASES.length} right | first word median ${med(firstWords)} ms | whole reply median ${med(wholes)} ms | missed: ${misses.join("; ") || "none"}`);
        await fetch(`${OLLAMA}/api/generate`, { method: "POST", body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => {}); // free the memory
      }
    } finally {
      await g.close();
    }
    ciNote("Local brain candidates", lines.join(" || "));
    expect(lines.length).toBe(MODELS.length);
  }, 3_600_000);
});
