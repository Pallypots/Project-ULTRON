// Controlled experiment (Phase 0.2): does Ollama reuse what a model already read? Same request twice, then the same
// conversation extended by one turn, on gemma4:e2b (sliding-window attention) and, as a control, qwen3:0.6b.
// Records numbers only; no pass/fail on speed. Runs with ULTRON_TEST_OLLAMA=1 (CI, Linux).
import { describe, expect, it } from "vitest";
import { ciNote } from "./helpers.ts";

const enabled = process.env.ULTRON_TEST_OLLAMA === "1";
const OLLAMA = process.env.ULTRON_OLLAMA_URL ?? "http://127.0.0.1:11434";
const SYSTEM = "You are ULTRON, a witty, theatrical personal assistant. " + "Be concise and warm. Answer in one or two short sentences. ".repeat(60);

async function chat(model: string, messages: { role: string; content: string }[]) {
  const res = await fetch(`${OLLAMA}/api/chat`, { method: "POST", body: JSON.stringify({ model, stream: false, keep_alive: -1, think: false, options: { num_ctx: 8192, num_predict: 24 }, messages }) });
  const j = (await res.json()) as { message?: { content: string }; prompt_eval_count?: number; prompt_eval_duration?: number; load_duration?: number; error?: string };
  if (j.error) throw new Error(j.error);
  return { reply: j.message?.content ?? "", tokens: j.prompt_eval_count ?? 0, ms: Math.round((j.prompt_eval_duration ?? 0) / 1e6), loadMs: Math.round((j.load_duration ?? 0) / 1e6) };
}

async function pull(model: string) {
  const res = await fetch(`${OLLAMA}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: false }) });
  await res.text();
}

describe.skipIf(!enabled)("does Ollama reuse what the model already read? (controlled)", () => {
  for (const model of ["gemma4:e2b", "qwen3:0.6b"]) {
    it(`measures prefix reuse for ${model}`, async () => {
      if (model !== "gemma4:e2b") await pull(model);
      const base = [{ role: "system", content: SYSTEM }, { role: "user", content: "Hey Ultron, how's it going?" }];
      await chat(model, [{ role: "user", content: "warm up" }]); // load the model; different prompt (cold cache for SYSTEM)
      const first = await chat(model, base);
      const same = await chat(model, base); // identical request
      const extended = await chat(model, [...base, { role: "assistant", content: first.reply }, { role: "user", content: "I'm thinking of learning the guitar. What do you reckon?" }]);
      const changedTop = await chat(model, [{ role: "system", content: "X " + SYSTEM }, base[1]!]); // negative control: first token changed
      const f = (r: { tokens: number; ms: number }) => `${r.tokens} tok/${r.ms} ms`;
      ciNote(`Prompt reuse experiment: ${model}`, `first ${f(first)} | identical again ${f(same)} | extended by a turn ${f(extended)} | changed first word ${f(changedTop)}`);
      expect(first.tokens).toBeGreaterThan(100);
    }, 1_200_000);
  }
});
