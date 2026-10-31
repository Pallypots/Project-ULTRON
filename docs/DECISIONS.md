# Decision log

Each entry: date, decision, why, and how to revisit it.

### D-001 · 2026-10-30 · Custom lightweight core, borrowing OpenClaw patterns (option B)
A bounded **read-only** evaluation of OpenClaw (MIT, ~3M non-test LOC in `src/`, 77 root deps, several releases a week)
found that native Windows is rated **Alpha** by the project itself, the recommended Windows path runs the gateway in **WSL**, voice wake isn't documented
on Windows, plugins load in-process with full trust, and the default is full host access. Forking would mean constant rebase churn for a single owner.
We build a small TypeScript core and deliberately borrow: persona files, permission modes + exec binding, capability-typed provider registry,
device pairing, gateway/node protocol shape, PWA shell, `SKILL.md` format. **Caveat:** the blueprint asked for a one-day running PoC of both options;
this cycle did a desk evaluation only (nothing from OpenClaw was installed or run). See [OPENCLAW_SPIKE.md](OPENCLAW_SPIKE.md).
Revisit if mobile/channel reach becomes more important than Windows-native, or run stock OpenClaw beside ULTRON via MCP.

### D-002 · SQLite via Node's built-in `node:sqlite` (not Postgres + pgvector yet)
Zero install and no native compilation on Windows, plus FTS5 full-text search is built in. Postgres + pgvector can come when multi-device sync or embeddings need it;
the store classes are the only code that touches SQL. `node:sqlite` prints an "experimental" warning, which we suppress. It is stable enough for our use, and doctor checks it.

### D-003 · Keyword (BM25) memory retrieval first, embeddings later
Works offline with no embedding provider or key, is deterministic and testable, and explains itself. The retrieval call site is a single method, ready for hybrid search.

### D-004 · Explicit memory commands handled by code, not the model
"Remember…/Forget…" are parsed deterministically so saving and deleting are reliable, auditable and can't be triggered by injected text in model output.
Trade-off: no automatic memory extraction yet, which is intentional per the consent rules.

### D-005 · Hard delete for "forget"
Row and search index are removed immediately. Owner-made backups are the only remaining copies (documented in the user guide and SECURITY.md).

### D-006 · Desktop window = Edge app mode now, Tauri later
Tauri needs Rust + MSVC build tools on the owner's PC and couldn't be compiled in this cloud dev environment (no WebKit libs).
Microsoft Edge ships with Windows and `--app=` gives a chromeless window with zero extra installs. A Tauri shell is scaffolded in `apps/desktop/src-tauri` (unverified).

### D-007 · Default models
Anthropic: `claude-opus-5-5` (current default model per Anthropic's docs as of 2026-10-30), effort `low` for conversational latency/cost,
server-side refusal fallbacks enabled (`fallbacks: "default"`). OpenAI/local: **no default**; the owner picks a model because availability varies.
All are changeable in Settings without code.

### D-008 · Loopback-only gateway with Host/Origin checks + bearer token
Every request must target `localhost` (blocks DNS-rebinding) from a loopback Origin (blocks other websites). All non-public routes need a random 256-bit token
stored in the data folder. Remote access waits for Phase 5 (Tailscale + device pairing), never an open port.

### D-009 · npm workspaces, TypeScript run directly with `tsx`
No compile step for the server, so fewer moving parts for a non-technical owner. Pinned TypeScript 5.9 (7.x is the brand-new native compiler; not worth the risk yet).

### D-011 · 2026-10-30 · Speech recognition runs on the PC by default (local Whisper)
Free, private and offline after a one-time model download, matching the blueprint's privacy defaults. Implemented with transformers.js (ONNX Runtime),
so there's no Python, no separate service and no native compile for the owner. Cost: `onnxruntime-node` adds ~548 MB to `node_modules` because it bundles every OS;
the Windows x64 part is ~64 MB. OpenAI transcription is an optional cloud alternative. Engines sit behind `SttEngine`, so whisper.cpp or Piper-era local
services can replace this without UI changes.

### D-012 · 2026-10-30 · Push-to-talk over plain HTTP; realtime transport decided by measurement
See [VOICE.md](VOICE.md#voice-transport-livekit-vs-direct-provider-realtime-blueprint-phase-2-comparison). LiveKit is the leading candidate if
client-side barge-in plus streamed TTS can't meet latency targets on the owner's hardware.

### D-013 · 2026-10-30 · Local-first brain via Ollama
Owner requirement: ULTRON must be able to run "truly independently" of cloud AI. Ollama is the local engine: one Windows installer, automatic NVIDIA/AMD GPU
use, model management, and a stable HTTP API. We use its native `/api/chat` (not the OpenAI-compatible endpoint) to control thinking (`think: false`)
and hide reasoning text. Alternatives considered: bundling llama.cpp via `node-llama-cpp` (no separate install, but we'd own GPU backend selection and model
management); LM Studio (GUI-first, still supported through the OpenAI-compatible provider). Model recommendations come from detected VRAM/RAM and only
use tags confirmed in Ollama's docs on this date (`gemma4:e2b`, `qwen3:4b`, `qwen3:8b`, `gpt-oss:20b`, `gemma4:31b`); owners can type any library tag.
Cloud brains remain optional. Switching to one is announced in chat, colored amber, and audited.

### D-014 · 2026-10-30 · Brain switching is a deterministic command, not a model decision
"switch your brain to X" is parsed by code (like memory commands), resolved against what's actually installed/configured, and refused with a reason
otherwise. A model (or injected text) can't switch providers by itself.

### D-015 · 2026-10-30 · Local TTS: Kokoro via kokoro-js, deduped onto transformers v4
Kokoro-82M gives natural voices on CPU in a small download and is Apache-2.0. `kokoro-js` pins transformers v3; an npm `overrides` entry points it at
our v4 (all five APIs it uses exist unchanged), avoiding a second ONNX Runtime install. Piper was the alternative (good quality, but needs a native
binary + espeak-ng data per OS). Default voice "George" (British male) suits the persona without imitating any actor.

### D-016 · 2026-10-30 · Actions: typed tool registry + policy engine; reminders parsed by code
Each tool declares a Zod input schema (enforced), a JSON Schema for the model, a risk level L0–L3, a timeout and a plain-English preview. The runner
records every proposal in `tool_executions` (state machine proposed → awaiting_approval → running → succeeded/failed/denied/expired/cancelled). L2 needs
an owner click via an authenticated endpoint (never voice, never model text); approvals expire after 10 minutes and policy is re-checked at approval
time. L3 is blocked. A kill switch pauses everything but L0. Tool results go back to the model as data. Common reminder phrasing is parsed
deterministically (works with any brain) and goes through the same policy. The scheduler wakes for the next reminder (max 30 s sleep) and marks
reminders missed while offline instead of firing them late. The model ↔ tools loop is capped at 4 rounds.

### D-017 · 2026-10-30 · Local file index in SQLite FTS5, owner-approved folders only
Same engine as memory (no new dependency): file names weighted 4× over contents, BM25 ranking, porter stemming. Text formats and .docx (via a
dependency-free zip reader) are indexed; PDFs are name-only for now. Safety: folders are validated (no drives, home root, system, credential or ULTRON data
folders), symlinks are never followed, secrets are skipped by name, every read/open re-resolves the real path and checks it is inside an approved
folder, file content is returned to the model as `untrusted_file_content`, and opening on screen is an L2 action needing approval. Incremental re-index
by mtime/size at startup and every 30 minutes.

### D-018 · 2026-10-30 · Wake word via local VAD + local Whisper + server-side matching (no extra model)
openWakeWord would need a custom-trained "Ultron" model and another runtime; instead a lightweight energy VAD (adaptive noise floor, 300 ms pre-roll,
700 ms end-of-phrase) cuts phrases, the on-PC Whisper transcribes each, and the gateway checks for the wake name at the start of the utterance (tolerant
to typical mishearings). Non-addressed phrases are dropped on the server and never returned, logged or stored. Refused when speech recognition is set to
the cloud. Trade-offs: more CPU than a dedicated wake-word model, about 1–3 s latency per phrase, and no voice barge-in while ULTRON speaks (Esc/Talk interrupt).
Revisit with a trained openWakeWord model if CPU or latency is a problem on the owner's hardware.

### D-019 · 2026-10-30 · Connected Life Hub v1: connector framework + GitHub read-only via fine-grained token
Follows blueprint §17 ordering (shared schema, then GitHub read-only). Canonical events (`connector_events`, unique `dedupe_key`, urgency, `why`,
30-day expiry) and per-integration cursor/health rows. GitHub uses the REST API with a fine-grained PAT entered in the app (stored server-side, write-only;
the blueprint allows fine-grained tokens for the prototype; a GitHub App/OAuth flow needs an app registration and comes later). Only titles, states and links are stored;
bodies are not fetched, which minimises private content and prompt-injection surface. Rate limits back off to the reset time and keep the last good sync visible.
Write actions (draft issues/comments) are deliberately not included yet (UL-CON-005, behind approvals). Verified in CI against the real API with the
Actions-provided read-only `GITHUB_TOKEN` on this repository.

### D-027 · 2026-10-31 · Meaning-based file search on leading chunks only
Embedding every chunk of up to 25,000 files would take hours on a CPU. Only the first 3 chunks (~4,500 characters) of each file are embedded,
in background batches that yield to the event loop, with brute-force cosine at query time; results are merged with BM25 by reciprocal rank.
Vectors live in `doc_vectors` with ON DELETE CASCADE from `documents`, and are dropped when a file's content changes.

### D-026 · 2026-10-31 · Conversation notes written by the current brain, in idle time only
Titles ("Planning the Oogie port") are a weak memory of what happened. After 30 min of quiet, conversations with ≥4 complete messages get a
1–2 sentence third-person note from the current brain (local by default, so nothing leaves the PC unless the owner chose a cloud brain).
A local model serves one request at a time, so notes run only when no chat is streaming and are cancelled when the owner sends a message;
interrupted notes are retried on the next 5-minute tick. Notes pass the same credential filter as memories. They live on the conversation
row, so deleting a conversation deletes its note.

### D-025 · 2026-10-31 · More commands handled by code (extends D-016)
A CPU-only local brain takes 40–90 s per answer and sometimes fumbles tool calls; these commands are too common for that. Strict whole-message
patterns (open a URL/domain, add to / show the list, weather, arithmetic) run the same registered tools through the same policy engine
(approvals, kill switch, audit), with replies built only from the tool's result. Anything not matched exactly (e.g. "will it rain later?",
"I'd like you to open…") goes to the model.

### D-024 · 2026-10-31 · Don't trust the model's account of its own actions
CI caught gemma4:e2b answering "Approval requested to open https://example.com" with **no tool call** once the tool list grew to 19. Two
deterministic guards: (1) for local brains, `focusTools` offers only tool groups matched by keywords in the last two user messages (cloud brains
get all tools); a miss means the model answers in words, which the honesty check then covers. (2) `claimsUnbackedAction` scans the final reply;
if it claims a completed/queued action and no tool ran that turn, a visible correction is appended and `model.unbacked_claim` is audited.
Heuristic English regexes: false negatives are possible, false positives only add a harmless note.

### D-023 · 2026-10-30 · Knowledge tools without accounts, and input-dependent risk for web reads
Calculator (own parser, no `eval`), Wikipedia REST API, Open-Meteo weather and geocoding: all free, keyless and read-only, so they work for
every owner with no sign-up. Reading web pages is the dangerous one: a prompt-injected page or a confused model could put private data into a URL
(exfiltration) or aim at `localhost`/the LAN (SSRF). So `read_webpage` is **L0 only for links the owner typed in this conversation** and L2
(approval card) otherwise (`ToolDef.riskFor`); every request and redirect hop is DNS-resolved and refused if any address is
private/loopback/link-local; only http(s), no credentials in URLs, 2 MB cap, text/html or text/plain only. No general web search yet: the
free options are scraping (against site terms) or need keys; a keyed search provider can be added later as an opt-in.
Memory suggestions reuse the approval system (`save_memory`, L2) rather than letting the model write memories directly (D-004 still holds).

### D-022 · 2026-10-30 · Local embeddings for memory recall (hybrid with BM25)
Supersedes the "later" in D-003. `Xenova/all-MiniLM-L6-v2` via the already-installed transformers.js (no new dependency), vectors stored as
BLOBs in SQLite (`memory_vectors`, cascade-deleted with the memory, refreshed by content hash). Brute-force cosine is fine for thousands of
memories; a vector index can come later. Keyword and vector rankings are merged with reciprocal-rank fusion so exact names still win.
If the model can't load (offline first run), recall silently stays keyword-only. Verified in CI with the real model (`ULTRON_TEST_EMBED=1`).

### D-021 · 2026-10-30 · Kokoro fp16 by default (measured)
A CI benchmark showed q8 at 1.4–2.0× real time on CPU (gaps between sentences) while fp16/fp32 ran at ~0.8× on both Windows and Linux,
all intelligible. fp16 is half fp32's download for the same speed.

### D-020 · 2026-10-30 · Windows DPAPI for secrets at rest
`ProtectedData.Protect` (CurrentUser scope, fixed entropy) via Windows PowerShell 5.1 (present on every Windows install, has System.Security), with
plaintext sent over stdin. No native module, no extra dependency. Costs ~0.5 s per load/save, which only happens at startup and when a key changes.

### D-010 · SSE (not WebSocket) for streaming replies
Simpler, works through proxies, trivially testable. WebSocket/WebRTC will be introduced for voice (Phase 2) and multi-device push (Phase 5).
