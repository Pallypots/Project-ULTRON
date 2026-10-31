// End-to-end with a REAL local model through Ollama. Needs Ollama running and network for the first pull,
// so it only runs when ULTRON_TEST_OLLAMA=1 (CI sets it on Linux). Model: ULTRON_TEST_OLLAMA_MODEL or gemma4:e2b.
import { afterAll, describe, expect, it } from "vitest";
import { loadPersona } from "@ultron/agent-core";
import { Summarizer } from "../src/summarizer.ts";
import { ciNote, replyText, startGateway } from "./helpers.ts";

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
    const maths = await g.chat(await g.newConversation(), "I'm buying a $1299 laptop with 15% off, plus $4.99 shipping. What do I pay in total?");
    const mathTools = maths.filter((e) => e.type === "tool").map((e: any) => `${e.event.tool}:${e.event.status}`);
    const mathText = replyText(maths).replace(/\s+/g, " ");
    const mathResults = maths.filter((e) => e.type === "tool").map((e: any) => e.event.summary);
    const mathSummary = `tools=${JSON.stringify(mathTools)} asked=${JSON.stringify(mathResults)} correct=${/1,?109\.14/.test(mathText)} reply=${Date.now() - t3}ms ending="…${mathText.slice(-200)}"`;

    const t4 = Date.now();
    const hi = replyText(await g.chat(await g.newConversation(), "Hey Ultron, I'm back. Tell me a quick joke."));
    ciNote("Local brain maths", mathSummary);
    ciNote("Local brain personality", `reply=${Date.now() - t4}ms text="${hi.replace(/\s+/g, " ").slice(0, 300)}"`);
    expect(hi).not.toMatch(/<\/?think>/);

    // Informational: deep thinking on a classic trick question (intuitive answer 10 cents is wrong; it's 5 cents).
    const t6 = Date.now();
    const bat = replyText(await g.chat(await g.newConversation(), "Think hard about this: a bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?")).replace(/\s+/g, " ");
    ciNote("Local brain deep thinking", `correct=${/(?:\b5 cents|\$\s*0?\.05\b|\bfive cents|\b0\.05\b)/i.test(bat)} said10=${/(?:\$\s*0?\.10\b|\b10 cents)\s*(?:for|is the|\.)/i.test(bat)} took=${Date.now() - t6}ms ending="…${bat.slice(-220)}"`);

    // Informational: can this model see images (for "look at my screen")?
    const { OllamaProvider } = await import("@ultron/agent-core");
    ciNote("Local brain abilities", `${MODEL}: ${JSON.stringify(await new OllamaProvider({ model: MODEL }).capabilities())}`);

    // Informational: the note ULTRON writes itself about a finished conversation.
    const t5 = Date.now();
    const persona = () => loadPersona(new URL("../../../config/persona.json", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
    const notes = await new Summarizer({ stores: g.gw.stores, secrets: { get: () => null } as never, persona, mockDelayMs: 0 }, () => false, { idleMs: 0 }).tick();
    const noted = g.gw.stores.conversations.list().filter((c) => c.summary).map((c) => c.summary);
    ciNote("Local brain conversation notes", `notes=${notes} took=${Date.now() - t5}ms ${JSON.stringify(noted).slice(0, 700)}`);
  }, 1_800_000);
});
