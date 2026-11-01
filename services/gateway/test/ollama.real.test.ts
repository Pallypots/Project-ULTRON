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

  it("talks like a conversation when spoken to: short, no lists, quick to start", async () => {
    // A recorder between ULTRON and Ollama: exactly what was sent, so it can be replayed to find what breaks reuse.
    const { createServer } = await import("node:http");
    const sent: { at: number; path: string; body: string }[] = [];
    const proxy = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", async () => {
        sent.push({ at: Date.now(), path: req.url ?? "", body: b });
        const r = await fetch(`http://127.0.0.1:11434${req.url}`, { method: req.method, body: req.method === "GET" ? undefined : b });
        res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
        if (r.body) for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) res.write(c);
        res.end();
      });
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const before = g.gw.stores.preferences.get<Record<string, unknown>>("provider", {});
    g.gw.stores.preferences.set("provider", { ...before, baseUrl: `http://127.0.0.1:${(proxy.address() as { port: number }).port}` });
    const id = await g.newConversation();
    const lines: string[] = [];
    for (const said of ["Hey Ultron, how's it going?", "I'm thinking of learning the guitar. What do you reckon?"]) {
      const t0 = Date.now();
      let first = 0;
      const res = await g.gw.app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { authorization: `Bearer ${g.gw.token}`, host: "localhost:7477" }, payload: { content: said, inputMode: "voice" } });
      const events = res.body.split("\n\n").filter((l: string) => l.startsWith("data: ")).map((l: string) => JSON.parse(l.slice(6)));
      first = Date.now() - t0;
      const text = events.filter((e: { type: string }) => e.type === "delta").map((e: { text: string }) => e.text).join("").trim();
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/^\s*[-*•]\s|^#{1,3}\s/m); // no lists or headings read aloud
      expect(text.length, text).toBeLessThan(600); // a spoken turn, not an essay
      lines.push(`"${said}" → (${text.length} chars, ${Math.round(first / 1000)}s) ${text.replace(/\s+/g, " ").slice(0, 220)}`);
    }
    ciNote("Spoken conversation style (real local brain)", lines.join(" || "));
    // Phase 1.1: the second reply should reuse what the brain already read (stable prompt prefix).
    const { recent } = (await g.api("GET", "/api/perf")).body as { recent: { marks: Record<string, number>; llm: { loadMs: number; promptTokens: number; promptMs: number; outputTokens: number; outputMs: number }[] }[] };
    const [second, first] = recent;
    const fmt = (t: (typeof recent)[number]) => `read ${t.llm[0]?.promptTokens} tokens in ${t.llm[0]?.promptMs} ms, load ${t.llm[0]?.loadMs} ms, first word ${t.marks.first_token} ms, ${t.llm[0]?.outputTokens} tokens in ${t.llm[0]?.outputMs} ms`;
    ciNote("Prompt reuse (real local brain)", `turn 1: ${fmt(first!)} || turn 2: ${fmt(second!)}`);
    g.gw.stores.preferences.set("provider", before);
    proxy.close();
    // Replay what ULTRON sent, straight to Ollama, to see which part breaks reuse.
    const chats = sent.filter((s) => s.path === "/api/chat").map((s) => JSON.parse(s.body));
    ciNote("Requests ULTRON sent during the conversation", sent.map((s) => `${s.path} ${s.body.length}B`).join(", "));
    if (chats.length >= 2) {
      const [b1, b2] = chats.slice(-2);
      const prefixSame = JSON.stringify(b2.messages.slice(0, b1.messages.length)) === JSON.stringify(b1.messages);
      const play = async (b: any) => {
        const r = (await (await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ ...b, stream: false }) })).json()) as any;
        return { ms: Math.round((r.prompt_eval_duration ?? 0) / 1e6), tok: r.prompt_eval_count, reply: r.message?.content ?? "" };
      };
      const p1 = await play(b1);
      const p2 = await play(b2);
      const p2again = await play(b2);
      const p1b = await play(b1);
      const swapped = { ...b2, messages: b2.messages.map((m: any, i: number) => (i === b1.messages.length ? { ...m, content: p1b.reply } : m)) };
      const p2swapped = await play(swapped);
      const keys = (b: any) => Object.keys(b).sort().join(",");
      ciNote(
        "Replay of ULTRON's own requests",
        `earlier messages identical=${prefixSame} keys1=${keys(b1)} keys2=${keys(b2)} think=${JSON.stringify(b2.think)} | turn1 ${p1.tok} tok/${p1.ms} ms | turn2 ${p2.tok} tok/${p2.ms} ms | turn2 again ${p2again.tok} tok/${p2again.ms} ms | turn2 after turn1, with turn1's exact new reply ${p2swapped.tok} tok/${p2swapped.ms} ms | stored reply="${b2.messages[b1.messages.length]?.content?.slice(0, 120)}" generated="${p1b.reply.slice(0, 120)}"`,
      );
    }
    expect(second!.llm[0]!.promptMs).toBeLessThan(first!.llm[0]!.promptMs * 0.7);
  }, 900_000);
});
