// End-to-end with a REAL local model through Ollama. Needs Ollama running and network for the first pull,
// so it only runs when ULTRON_TEST_OLLAMA=1 (CI sets it on Linux). Model: ULTRON_TEST_OLLAMA_MODEL or gemma4:e2b.
import { afterAll, describe, expect, it } from "vitest";
import { replyText, startGateway } from "./helpers.ts";

const enabled = process.env.ULTRON_TEST_OLLAMA === "1";
const MODEL = process.env.ULTRON_TEST_OLLAMA_MODEL ?? "gemma4:e2b";

describe.skipIf(!enabled)(`real local brain via Ollama (${MODEL})`, () => {
  let g: Awaited<ReturnType<typeof startGateway>>;
  afterAll(async () => g?.close());

  it("downloads the model, switches to it by chat, and answers locally", async () => {
    g = await startGateway();
    const t0 = Date.now();
    const status = (await g.api("GET", "/api/local-ai/status")).body;
    expect(status.ollama.running).toBe(true);
    if (!status.models.some((m: any) => m.name === MODEL)) {
      await g.api("POST", "/api/local-ai/pull", { model: MODEL });
      for (;;) {
        const p = (await g.api("GET", "/api/local-ai/status")).body.pulls.find((x: any) => x.model === MODEL);
        if (p.status !== "downloading") {
          expect(p.status, p.detail).toBe("success");
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    const pullMs = Date.now() - t0;
    const id = await g.newConversation();
    const sw = replyText(await g.chat(id, "Ultron, switch your brain to local"));
    expect(sw).toMatch(/running entirely on this computer/);
    const t1 = Date.now();
    const events = await g.chat(id, "In one short sentence, what is the capital of France?");
    const ms = Date.now() - t1;
    const err = events.find((e) => e.type === "error");
    expect(err, JSON.stringify(err)).toBeUndefined();
    const text = replyText(events);
    const summary = `model=${MODEL} pull+setup=${pullMs}ms reply=${ms}ms text="${text.replace(/\s+/g, " ").slice(0, 200)}"`;
    console.log(`[ollama] ${summary}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Real local brain (${process.platform})::${summary}`);
    expect(text).toMatch(/paris/i);
    expect(text).not.toMatch(/<\/?think>/);

    // Informational: does this small local model use tools? (Not a pass/fail gate; models vary.)
    process.env.ULTRON_ACTIONS_DRY_RUN = "1";
    const t2 = Date.now();
    const act = await g.chat(id, "Please open https://example.com in my browser.");
    const tools = act.filter((e) => e.type === "tool").map((e: any) => `${e.event.tool}:${e.event.status}`);
    const toolSummary = `model=${MODEL} tools=${JSON.stringify(tools)} reply=${Date.now() - t2}ms text="${replyText(act).replace(/\s+/g, " ").slice(0, 160)}"`;
    console.log(`[ollama-tools] ${toolSummary}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Local brain tool use (${process.platform})::${toolSummary}`);
    // Whatever the model did, nothing external may have run without approval.
    expect(tools.filter((t) => t.startsWith("open_website:") && t !== "open_website:awaiting_approval")).toEqual([]);

    // Informational: does it hand maths to the calculator, and does the personality come through?
    const t3 = Date.now();
    const maths = await g.chat(await g.newConversation(), "What is 1299 times 0.85, plus 4.99?");
    const mathTools = maths.filter((e) => e.type === "tool").map((e: any) => `${e.event.tool}:${e.event.status}`);
    const mathSummary = `tools=${JSON.stringify(mathTools)} correct=${/1,?109\.14/.test(replyText(maths))} reply=${Date.now() - t3}ms text="${replyText(maths).replace(/\s+/g, " ").slice(0, 160)}"`;
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Local brain maths (${process.platform})::${mathSummary}`);
    const t4 = Date.now();
    const hi = replyText(await g.chat(await g.newConversation(), "Hey Ultron, I'm back. Tell me a quick joke."));
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Local brain personality (${process.platform})::reply=${Date.now() - t4}ms text="${hi.replace(/\s+/g, " ").slice(0, 300)}"`);
    expect(hi).not.toMatch(/<\/?think>/);
  }, 1_800_000);
});
