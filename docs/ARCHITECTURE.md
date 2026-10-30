# Architecture (v0.1)

```text
 Desktop window (Edge app mode today; Tauri shell later)      future: phone PWA, laptop
            │  HTTP + Server-Sent Events, Bearer session token, loopback only
            ▼
 ┌──────────────────────── services/gateway (Fastify) ─────────────────────────┐
 │ auth (Host/Origin loopback check + token) · routes · SSE chat stream          │
 │ chat orchestrator: intent → memory commands │ retrieval → prompt → provider   │
 │ capabilities (single source of "what can I do")  · stop-all · log redaction   │
 └───────────────┬───────────────────────────────┬──────────────────────────────┘
                 │                               │
     packages/agent-core                  packages/memory (persistence)
     persona.json → system prompt         SQLite via built-in node:sqlite
     intent detection + sensitive guard   migrations · conversations · messages
     ModelProvider: mock │ anthropic │    memories + FTS5 (BM25) retrieval
       openai-compatible (OpenAI/Ollama)  audit_events · preferences
                 │
     packages/schemas (Zod contracts shared by gateway and UI)
```

## Key flows
**Chat turn** (`POST /api/conversations/:id/messages`, streamed as SSE):
1. Persist the user message and an assistant placeholder (`status: streaming`). Emit `start`.
2. `detectIntent`: explicit **remember / forget / blocked** commands are handled deterministically, so memory never depends on the model.
3. Otherwise, retrieve memories (pinned + top BM25 matches) and emit `memories` (citations).
4. Build the system prompt from `config/persona.json`, the **live capability list**, and the memories.
5. Stream from the provider and emit `delta` events. Partial text is flushed to the DB every second, so a crash keeps what was said.
6. Finalize as `complete`, `cancelled` (Stop or client disconnect aborts the provider request) or `error` (human-readable message + code).
On startup, any message still `streaming` from a crash is marked `cancelled [interrupted]`.

**Memory model:** `kind` (fact/preference/project/note), `source` + `source_conversation_id` + `source_message_id` (provenance),
`confirmed`, `pinned`, `confidence`, `sensitivity`, `review_at`, timestamps. Deletion is hard (row + FTS entry).
Retrieval is behind `MemoryStore.retrieveForPrompt`, so embedding search can replace or augment BM25 later without touching callers.

**Single source of truth:** the gateway owns all state. Clients hold no data except UI preferences and the session token.

**Voice input (v0.2):** UI `Recorder` (getUserMedia → AudioWorklet → 16 kHz WAV) → `POST /api/voice/transcribe` → `SttManager.current()`
(`LocalWhisperEngine` | `OpenAISttEngine` | `MockSttEngine`) → text → the normal chat turn with `inputMode: "voice"`. See [VOICE.md](VOICE.md).

**Local brain (v0.3):** `OllamaProvider` (agent-core) streams `/api/chat`. Gateway `local-ai/` holds `detectHardware`, `recommendModel`,
and `OllamaManager` (version, installed models, background pulls). `brains.ts` resolves "switch your brain to X" against installed and configured brains.

## API
`GET /api/health` (public, sanitized) · `GET /api/bootstrap` (loopback-only token handout) · `GET /api/status` · `GET /api/capabilities`
`GET/POST /api/conversations` · `GET/DELETE /api/conversations/:id` · `POST /api/conversations/:id/messages` (SSE)
`GET/POST /api/memories` · `PATCH/DELETE /api/memories/:id` · `POST /api/memories/search` · `GET /api/memories/export`
`GET/PUT /api/settings/provider` · `DELETE /api/settings/provider/:p/key` · `POST /api/settings/provider/test`
`GET /api/local-ai/status` · `POST /api/local-ai/pull` · `POST /api/local-ai/pull/cancel` · `POST /api/local-ai/use`
`GET /api/voice/status` · `PUT /api/voice/settings` · `POST /api/voice/prepare` · `POST /api/voice/transcribe` (audio/wav)
`POST /api/stop` · `GET /api/activity` · `GET /api/logs/export` · `POST /api/persona/reload`

## Repo layout
```text
apps/desktop          React UI (Vite) + experimental Tauri shell (src-tauri)
services/gateway      HTTP API, auth, chat orchestration
packages/schemas      shared Zod types
packages/audio        WAV encode/decode, resampling (shared by UI and gateway)
packages/agent-core   persona, prompt, intents, model providers
packages/memory       SQLite persistence, migrations, retrieval, audit
config/persona.json   ULTRON's identity (version-controlled)
scripts/              launcher, doctor, backup, dev, e2e
```
Blueprint folders not created yet (voice, worker, integrations, permissions, ui, web) arrive with their tickets.

## Planned: Connected Life Hub (blueprint §17)
`packages/integrations/{github,youtube,reddit,discord}` will implement a shared `Connector` interface
(`connect / refreshAuth / getCapabilities / healthCheck / sync(cursor) / listEvents / search / prepareAction / executeApprovedAction / disconnect`)
with capability flags, a canonical event table (dedupe key, cursor checkpoints, retention) and canonical action records that always pass
through the policy/approval engine (UL-010). Connector content is untrusted data and can never trigger tools. Order: GitHub read-only → YouTube → Reddit (after API approval) → Discord (official bot only).
