import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { loadPersona, type Persona } from "@ultron/agent-core";
import { openStores, redact, type Stores } from "@ultron/memory";
import { decodeWav, rms, WavError } from "@ultron/audio";
import { MemoryCreate, MemoryPatch, ProviderSettingsUpdate, SendMessage, TtsSettingsUpdate, VoiceSettingsUpdate, type ChatEvent, type TranscribeResult, type TtsStatusResponse, type VoiceStatus } from "@ultron/schemas";
import { ZodError } from "zod";
import { isLoopbackRequest, loadOrCreateToken, registerAuth } from "./auth.ts";
import { currentCapabilities } from "./capabilities.ts";
import { ActiveStreams, handleUserMessage } from "./chat.ts";
import { loadConfig, type GatewayConfig } from "./config.ts";
import { isLocalProvider, readProviderSettings, resolveProvider, saveProviderSettings, SECRET_FOR } from "./providers.ts";
import { detectHardware } from "./local-ai/hardware.ts";
import { EventBus } from "./actions/events.ts";
import { ActionRunner } from "./actions/runner.ts";
import { ReminderScheduler } from "./actions/scheduler.ts";
import { OllamaManager } from "./local-ai/ollama.ts";
import { recommendModel } from "./local-ai/recommend.ts";
import { z } from "zod";
import { SecretStore } from "./secrets.ts";
import { SttError, SttManager } from "./stt/index.ts";
import { TtsError, TtsManager } from "./tts/index.ts";
import { encodeWav, toSpeakable } from "@ultron/audio";

export const VERSION = "0.5.0";
export const MAX_VOICE_SECONDS = 120;

export interface Gateway {
  app: FastifyInstance;
  stores: Stores;
  token: string;
  config: GatewayConfig;
  logLines: string[];
}

export async function buildGateway(overrides: Partial<GatewayConfig> = {}): Promise<Gateway> {
  const config = loadConfig(overrides);
  const stores = openStores(join(config.dataDir, "ultron.db"));
  const secrets = new SecretStore(config.dataDir);
  const token = loadOrCreateToken(config.dataDir);
  const recovered = stores.conversations.recoverInterrupted();
  const streams = new ActiveStreams();
  let persona: Persona = loadPersona(config.personaFile);

  // Every log line passes through redaction (pattern-based plus exact known secret values).
  const logLines: string[] = [];
  const scrub = (line: string) => {
    let out = String(redact(line));
    for (const v of [...secrets.values(), token]) out = out.split(v).join("[REDACTED]");
    return out;
  };
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
      stream: {
        write: (line: string) => {
          const clean = scrub(line);
          logLines.push(clean);
          if (logLines.length > 2000) logLines.shift();
          if (!process.env.VITEST) process.stdout.write(clean);
        },
      },
    },
    bodyLimit: 1_000_000,
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid_request", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: "error", message: status >= 500 ? "ULTRON hit an internal error. Details are in the log." : (err as Error).message });
  });

  registerAuth(app, token);
  if (recovered) stores.audit.record("recovery.interrupted_messages", "system", null, { count: recovered });

  const settings = () => readProviderSettings(stores.preferences);
  const stt = new SttManager(config.dataDir, stores.preferences, secrets);
  const tts = new TtsManager(config.dataDir, stores.preferences);
  const savedModels = stores.preferences.get<Record<string, { model: string; baseUrl: string }>>("provider_models", {});
  const ollama = new OllamaManager(savedModels.ollama?.baseUrl || process.env.ULTRON_OLLAMA_URL || undefined);
  const bus = new EventBus();
  const actions = new ActionRunner(stores, bus, process.env.ULTRON_ACTIONS_DRY_RUN === "1");
  const scheduler = new ReminderScheduler(stores, bus);
  // A new or cancelled reminder may be sooner than the scheduler's next wake-up.
  bus.subscribe((e) => {
    if (e.type === "action_updated" && e.execution.status === "succeeded" && /reminder/.test(e.execution.tool)) scheduler.reschedule();
  });
  scheduler.start();
  const deps = { stores, secrets, persona: () => persona, mockDelayMs: config.mockDelayMs, stt: () => stt.current(), ttsEngine: () => tts.settings().engine, ollama, actions };

  // ---- public ----
  app.get("/api/health", async () => ({ ok: true, name: "ULTRON", version: VERSION }));
  app.get("/api/bootstrap", async (req, reply) => {
    if (!isLoopbackRequest(req) || req.headers["sec-fetch-site"] === "cross-site") return reply.code(403).send({ error: "forbidden" });
    return { token };
  });

  // ---- status ----
  app.get("/api/capabilities", async () => {
    const s = settings();
    return { capabilities: currentCapabilities(s, resolveProvider(s, secrets, config.mockDelayMs), stt.current(), tts.settings().engine) };
  });
  app.get("/api/status", async () => {
    const s = settings();
    const r = resolveProvider(s, secrets, config.mockDelayMs);
    return {
      version: VERSION,
      provider: s.provider,
      model: r.ok ? r.provider.model : s.model,
      providerReady: r.ok,
      where: s.provider === "mock" ? "test" : isLocalProvider(s.provider) ? "local" : "cloud",
      providerProblem: r.ok ? null : r.reason,
      activeReplies: streams.size,
      pendingApprovals: stores.actions.pending().length,
      upcomingReminders: stores.reminders.upcoming().length,
      counts: { conversations: stores.conversations.list().length, memories: stores.memories.list().length },
      persona: { name: persona.name },
    };
  });

  // ---- settings ----
  app.get("/api/settings/provider", async () => {
    const s = settings();
    return {
      ...s,
      keys: Object.fromEntries(Object.entries(SECRET_FOR).filter(([, v]) => v).map(([k, v]) => [k, secrets.has(v!)])),
    };
  });
  app.put("/api/settings/provider", async (req) => {
    const body = ProviderSettingsUpdate.parse(req.body);
    const next = { provider: body.provider, model: body.model ?? "", baseUrl: body.baseUrl ?? "" };
    saveProviderSettings(stores.preferences, next);
    if (body.provider === "ollama") ollama.setUrl(next.baseUrl);
    const secretName = SECRET_FOR[body.provider];
    if (secretName && body.apiKey) secrets.set(secretName, body.apiKey);
    stores.audit.record("settings.provider_changed", "owner", body.provider, { model: next.model, keyUpdated: Boolean(body.apiKey) });
    const r = resolveProvider(next, secrets, config.mockDelayMs);
    return { ok: r.ok, problem: r.ok ? null : r.reason };
  });
  app.delete<{ Params: { provider: "anthropic" | "openai" } }>("/api/settings/provider/:provider/key", async (req, reply) => {
    const name = SECRET_FOR[req.params.provider];
    if (!name) return reply.code(404).send({ error: "not_found" });
    secrets.set(name, null);
    stores.audit.record("settings.key_removed", "owner", req.params.provider);
    return { ok: true };
  });
  app.post("/api/settings/provider/test", async () => {
    const s = settings();
    const r = resolveProvider(s, secrets, config.mockDelayMs);
    if (!r.ok) return { ok: false, message: r.reason };
    const started = Date.now();
    try {
      let text = "";
      const ctl = AbortSignal.timeout(30_000);
      for await (const t of r.provider.stream({ system: "Reply with the single word: ready", messages: [{ role: "user", content: "Connection test" }], memories: [], signal: ctl })) {
        text += t;
        if (text.length > 200) break;
      }
      return { ok: true, message: `Connected to ${r.provider.id} / ${r.provider.model} in ${Date.now() - started} ms.`, sample: text.slice(0, 200) };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  // ---- local AI (Ollama) ----
  app.get("/api/local-ai/status", async () => {
    const hw = await detectHardware();
    const version = await ollama.version();
    const models = version ? await ollama.models().catch(() => []) : [];
    const s = settings();
    return {
      ollama: { running: Boolean(version), version, url: ollama.url },
      models,
      pulls: ollama.pullStates(),
      hardware: {
        ramGb: +(hw.ramBytes / 1024 ** 3).toFixed(1),
        cpuThreads: hw.cpuThreads,
        gpus: hw.gpus.map((g) => ({ name: g.name, vramGb: +(g.vramBytes / 1024 ** 3).toFixed(1), vendor: g.vendor })),
        usableGpu: hw.usableGpu ? { name: hw.usableGpu.name, vramGb: +(hw.usableGpu.vramBytes / 1024 ** 3).toFixed(1) } : null,
      },
      recommendation: recommendModel(hw),
      active: s.provider === "ollama" ? s.model : null,
    };
  });
  const ModelName = z.object({ model: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9._:/-]+$/, "Model names use letters, numbers, dots, dashes, colons and slashes.") });
  app.post("/api/local-ai/pull", async (req, reply) => {
    const { model } = ModelName.parse(req.body);
    if (!(await ollama.version())) return reply.code(409).send({ error: "ollama_not_running", message: "Ollama isn't running. Install it from ollama.com/download or start the Ollama app." });
    stores.audit.record("local_ai.download_started", "owner", model);
    return ollama.startPull(model);
  });
  app.post("/api/local-ai/pull/cancel", async (req) => ({ cancelled: ollama.cancelPull(ModelName.parse(req.body).model) }));
  app.post("/api/local-ai/use", async (req, reply) => {
    const { model } = ModelName.parse(req.body);
    const installed = (await ollama.models().catch(() => [])).map((m) => m.name);
    if (!installed.includes(model)) return reply.code(409).send({ error: "not_installed", message: `"${model}" isn't downloaded yet.` });
    saveProviderSettings(stores.preferences, { provider: "ollama", model, baseUrl: ollama.url });
    stores.audit.record("settings.brain_switched", "owner", "ollama", { model, via: "settings" });
    return { ok: true };
  });

  // ---- conversations ----
  app.get("/api/conversations", async () => ({ conversations: stores.conversations.list() }));
  app.post("/api/conversations", async () => ({ conversation: stores.conversations.create() }));
  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const conversation = stores.conversations.get(req.params.id);
    if (!conversation) return reply.code(404).send({ error: "not_found", message: "Conversation not found." });
    return { conversation, messages: stores.conversations.messages(conversation.id) };
  });
  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    if (!stores.conversations.delete(req.params.id)) return reply.code(404).send({ error: "not_found" });
    stores.audit.record("conversation.deleted", "owner", req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/conversations/:id/messages", async (req, reply) => {
    const body = SendMessage.parse(req.body);
    if (!stores.conversations.get(req.params.id)) return reply.code(404).send({ error: "not_found", message: "Conversation not found." });
    const ctl = streams.start(req.params.id);
    if (!ctl) return reply.code(409).send({ error: "busy", message: "ULTRON is still answering in this conversation. Stop it or wait." });

    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const emit = (e: ChatEvent) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    // Client hung up mid-reply: stop generating (and spending) immediately.
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) ctl.abort();
    });
    try {
      await handleUserMessage(deps, req.params.id, body.content, { deviceId: body.deviceId, inputMode: body.inputMode, signal: ctl.signal, emit });
    } catch (err) {
      app.log.error(err);
      emit({ type: "error", code: "internal", message: "ULTRON hit an internal error. Details are in the log." });
    } finally {
      streams.finish(req.params.id);
      reply.raw.end();
    }
  });

  // ---- voice ----
  const voiceStatus = (): VoiceStatus => {
    const engine = stt.current();
    return { engine: engine.id, model: engine.model, ...engine.status(), privacy: engine.privacy, maxSeconds: MAX_VOICE_SECONDS };
  };
  app.get("/api/voice/status", async () => voiceStatus());
  app.put("/api/voice/settings", async (req) => {
    const body = VoiceSettingsUpdate.parse(req.body);
    stores.preferences.set("voice", { engine: body.engine, model: body.model ?? "" });
    stores.audit.record("settings.voice_changed", "owner", body.engine, { model: body.model ?? "" });
    return voiceStatus();
  });
  app.post("/api/voice/prepare", async () => {
    // Starts loading/downloading in the background; clients poll /api/voice/status for progress.
    stt.current().prepare().catch((err) => app.log.warn({ err: (err as Error).message }, "speech model failed to load"));
    return voiceStatus();
  });
  // Raw audio is processed in memory only and never written to disk. The audit log records that the mic was used, never what was said.
  app.addContentTypeParser(["audio/wav", "audio/x-wav", "audio/wave"], { parseAs: "buffer", bodyLimit: 16_000_000 }, (_req, body, done) => done(null, body));
  app.post("/api/voice/transcribe", { bodyLimit: 16_000_000 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: "unsupported_media_type", message: "Send audio as audio/wav." });
    let decoded;
    try {
      decoded = decodeWav(new Uint8Array(req.body));
    } catch (err) {
      if (err instanceof WavError) return reply.code(400).send({ error: "bad_audio", message: err.message });
      throw err;
    }
    if (decoded.seconds < 0.3) return reply.code(400).send({ error: "too_short", message: "That was too short to hear anything. Hold the talk button while you speak." });
    if (decoded.seconds > MAX_VOICE_SECONDS) return reply.code(413).send({ error: "too_long", message: `Voice messages are limited to ${MAX_VOICE_SECONDS / 60} minutes.` });
    const engine = stt.current();
    const started = Date.now();
    const level = rms(decoded.samples);
    if (level < 0.002) {
      stores.audit.record("voice.transcribed", "owner", null, { engine: engine.id, seconds: +decoded.seconds.toFixed(1), result: "silent" });
      return reply.code(422).send({ error: "silent", message: "I didn't hear anything. Check that the right microphone is selected and not muted." });
    }
    try {
      const text = await engine.transcribe(decoded.samples, new Uint8Array(req.body));
      const elapsedMs = Date.now() - started;
      stores.audit.record("voice.transcribed", "owner", null, { engine: engine.id, seconds: +decoded.seconds.toFixed(1), ms: elapsedMs, chars: text.length });
      const result: TranscribeResult = { text, engine: engine.id, model: engine.model, audioSeconds: +decoded.seconds.toFixed(2), elapsedMs };
      return result;
    } catch (err) {
      const e = err instanceof SttError ? err : new SttError(`Speech recognition failed: ${(err as Error).message}`, "failed");
      stores.audit.record("voice.error", "system", null, { engine: engine.id, code: e.code });
      return reply.code(e.code === "not_configured" ? 409 : 503).send({ error: e.code, message: e.message });
    }
  });

  // ---- spoken replies ----
  const ttsStatus = (): TtsStatusResponse => {
    const s = tts.settings();
    const engine = tts.current();
    const st = engine ? engine.status() : { state: "ready" as const, detail: "Using this computer's built-in voices (no download)." };
    return { engine: s.engine, voice: s.voice, speed: s.speed, voices: engine?.voices ?? [], ...st };
  };
  app.get("/api/voice/tts/status", async () => ttsStatus());
  app.put("/api/voice/tts/settings", async (req) => {
    const body = TtsSettingsUpdate.parse(req.body);
    const cur = tts.settings();
    stores.preferences.set("tts", { engine: body.engine, voice: body.voice ?? cur.voice, speed: body.speed ?? cur.speed });
    stores.audit.record("settings.tts_changed", "owner", body.engine, { voice: body.voice ?? cur.voice });
    return ttsStatus();
  });
  app.post("/api/voice/tts/prepare", async () => {
    tts.current()?.prepare().catch((err) => app.log.warn({ err: (err as Error).message }, "voice failed to load"));
    return ttsStatus();
  });
  const SpeakBody = z.object({ text: z.string().max(2000), voice: z.string().max(50).optional(), speed: z.number().min(0.5).max(2).optional() });
  // Speech is generated in memory and streamed back; nothing is written to disk.
  app.post("/api/voice/speak", async (req, reply) => {
    const body = SpeakBody.parse(req.body);
    const engine = tts.current();
    if (!engine) return reply.code(409).send({ error: "browser_engine", message: "Spoken replies are set to use this computer's built-in voices." });
    const text = toSpeakable(body.text);
    if (!text) return reply.code(204).send();
    const s = tts.settings();
    try {
      const { samples, sampleRate } = await engine.synthesize(text, body.voice ?? s.voice, body.speed ?? s.speed);
      reply.header("content-type", "audio/wav").header("cache-control", "no-store");
      return reply.send(Buffer.from(encodeWav(samples, sampleRate)));
    } catch (err) {
      const e = err instanceof TtsError ? err : new TtsError((err as Error).message, "failed");
      return reply.code(503).send({ error: e.code, message: e.message });
    }
  });

  // ---- live events (reminders, approvals) ----
  app.get("/api/events", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const send = (e: unknown) => !reply.raw.writableEnded && reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: "hello", at: new Date().toISOString() });
    const unsubscribe = bus.subscribe(send);
    const keepAlive = setInterval(() => !reply.raw.writableEnded && reply.raw.write(": keep-alive\n\n"), 25_000);
    req.raw.on("close", () => {
      unsubscribe();
      clearInterval(keepAlive);
    });
  });

  // ---- reminders ----
  app.get("/api/reminders", async () => ({ reminders: stores.reminders.list() }));
  const NewReminder = z.object({ text: z.string().trim().min(1).max(300), dueAt: z.string().datetime({ offset: true }) });
  app.post("/api/reminders", async (req, reply) => {
    const body = NewReminder.parse(req.body);
    const due = new Date(body.dueAt);
    if (due.getTime() < Date.now() - 60_000) return reply.code(400).send({ error: "past", message: "That time has already passed." });
    const r = stores.reminders.create({ text: body.text, dueAt: due, source: "manual" });
    stores.audit.record("reminder.created", "owner", r.id, { via: "app" });
    scheduler.reschedule();
    return { reminder: r };
  });
  app.post<{ Params: { id: string } }>("/api/reminders/:id/cancel", async (req, reply) => {
    const r = stores.reminders.get(req.params.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    if (r.status !== "scheduled" && r.status !== "missed") return reply.code(409).send({ error: "not_active", message: "That reminder isn't active." });
    stores.audit.record("reminder.cancelled", "owner", r.id, { via: "app" });
    return { reminder: stores.reminders.setStatus(r.id, r.status === "missed" ? "fired" : "cancelled") };
  });

  // ---- actions & approvals ----
  app.get("/api/actions", async () => {
    stores.actions.expireStale(10 * 60_000);
    return { actions: stores.actions.list(), pending: stores.actions.pending(), policy: actions.policy() };
  });
  app.post<{ Params: { id: string } }>("/api/actions/:id/approve", async (req, reply) => {
    const r = await actions.resolve(req.params.id, true);
    return "failure" in r ? reply.code(r.code).send({ error: "cannot_approve", message: r.failure }) : { action: r };
  });
  app.post<{ Params: { id: string } }>("/api/actions/:id/deny", async (req, reply) => {
    const r = await actions.resolve(req.params.id, false);
    return "failure" in r ? reply.code(r.code).send({ error: "cannot_deny", message: r.failure }) : { action: r };
  });
  app.put("/api/settings/actions", async (req) => {
    const body = z.object({ paused: z.boolean(), confirmLowRisk: z.boolean() }).parse(req.body);
    stores.preferences.set("actions", body);
    stores.audit.record(body.paused ? "actions.paused" : "actions.policy_changed", "owner", null, body);
    return { policy: body };
  });

  // Emergency stop: cancels every in-flight reply and every action waiting for approval.
  app.post("/api/stop", async () => {
    const stopped = streams.stopAll();
    const cancelledActions = actions.denyAllPending();
    stores.audit.record("system.stop_all", "owner", null, { stopped, cancelledActions });
    return { stopped, cancelledActions };
  });

  // ---- memory vault ----
  app.get("/api/memories", async () => ({ memories: stores.memories.list() }));
  app.post("/api/memories", async (req) => {
    const body = MemoryCreate.parse(req.body);
    const memory = stores.memories.create({ ...body, source: "manual" });
    stores.audit.record("memory.created", "owner", memory.id, { via: "vault", kind: memory.kind });
    return { memory };
  });
  app.patch<{ Params: { id: string } }>("/api/memories/:id", async (req, reply) => {
    const memory = stores.memories.update(req.params.id, MemoryPatch.parse(req.body));
    if (!memory) return reply.code(404).send({ error: "not_found" });
    stores.audit.record("memory.updated", "owner", memory.id, { fields: Object.keys(req.body as object) });
    return { memory };
  });
  app.delete<{ Params: { id: string } }>("/api/memories/:id", async (req, reply) => {
    if (!stores.memories.delete(req.params.id)) return reply.code(404).send({ error: "not_found" });
    stores.audit.record("memory.deleted", "owner", req.params.id, { via: "vault" });
    return { ok: true };
  });
  app.post("/api/memories/search", async (req) => {
    const { query } = (req.body ?? {}) as { query?: string };
    return { memories: stores.memories.search(String(query ?? ""), 10) };
  });
  app.get("/api/memories/export", async (_req, reply) => {
    stores.audit.record("memory.exported", "owner");
    reply.header("content-disposition", `attachment; filename="ultron-memories-${new Date().toISOString().slice(0, 10)}.json"`);
    return { exportedAt: new Date().toISOString(), memories: stores.memories.list() };
  });

  // ---- activity ----
  app.get("/api/activity", async () => ({ events: stores.audit.list() }));
  app.get("/api/logs/export", async (_req, reply) => {
    reply.header("content-type", "text/plain; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="ultron-logs.txt"');
    return logLines.join("");
  });

  app.post("/api/persona/reload", async () => {
    persona = loadPersona(config.personaFile);
    return { ok: true, name: persona.name };
  });

  // ---- UI ----
  if (config.uiDir) {
    await app.register(fastifyStatic, { root: config.uiDir, index: ["index.html"] });
    const indexHtml = readFileSync(join(config.uiDir, "index.html"), "utf8");
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.type("text/html").send(indexHtml);
    });
  } else {
    app.get("/", async (_req, reply) =>
      reply.type("text/html").send("<h1>ULTRON gateway is running</h1><p>The UI hasn't been built yet. Run <code>npm run build</code>, or use <code>npm run dev</code>.</p>"),
    );
  }

  app.addHook("onClose", async () => {
    scheduler.stop();
    streams.stopAll();
    stores.close();
  });

  return { app, stores, token, config, logLines };
}
