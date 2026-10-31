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

    // Informational: "look at my screen" with a real vision-capable local brain. The "screen" is a solid red picture.
    const { deflateSync } = await import("node:zlib");
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const png = (w: number, h: number, rgb: [number, number, number]) => {
      const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
      });
      const crc = (b: Buffer) => {
        let c = 0xffffffff;
        for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
      };
      const chunk = (type: string, data: Buffer) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const c = Buffer.alloc(4);
        c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
      };
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(w, 0);
      ihdr.writeUInt32BE(h, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
    };
    const shot = join(tmpdir(), "ultron-red-screen.png");
    writeFileSync(shot, png(64, 64, [220, 20, 20]));
    process.env.ULTRON_FAKE_SCREENSHOT = shot;
    const t7 = Date.now();
    const seen = replyText(await g.chat(await g.newConversation(), "Look at my screen. What single colour fills it? Answer in one word.")).replace(/\s+/g, " ");
    delete process.env.ULTRON_FAKE_SCREENSHOT;
    ciNote("Local brain looks at the screen", `correct=${/\bred\b/i.test(seen)} took=${Date.now() - t7}ms reply="${seen.slice(0, 200)}"`);

    // Informational: deep research with the real local brain and real Wikipedia (no web-search key in CI).
    const t8 = Date.now();
    const brief = replyText(await g.chat(await g.newConversation(), "research how solid-state batteries work")).replace(/\s+/g, " ");
    ciNote("Local brain deep research", `took=${Date.now() - t8}ms cites=${(brief.match(/\[\d\]/g) ?? []).length} ${brief.includes("Brief (") ? `brief="${brief.slice(brief.indexOf("Brief ("), brief.indexOf("Brief (") + 400)}"` : `NO BRIEF, reply="${brief.slice(0, 500)}"`}`);

    // Informational: the note ULTRON writes itself about a finished conversation.
    const t5 = Date.now();
    const persona = () => loadPersona(new URL("../../../config/persona.json", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
    const notes = await new Summarizer({ stores: g.gw.stores, secrets: { get: () => null } as never, persona, mockDelayMs: 0 }, () => false, { idleMs: 0 }).tick();
    const noted = g.gw.stores.conversations.list().filter((c) => c.summary).map((c) => c.summary);
    ciNote("Local brain conversation notes", `notes=${notes} took=${Date.now() - t5}ms ${JSON.stringify(noted).slice(0, 700)}`);
  }, 1_800_000);
});
