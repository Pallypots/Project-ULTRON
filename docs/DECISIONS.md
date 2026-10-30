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

### D-010 · SSE (not WebSocket) for streaming replies
Simpler, works through proxies, trivially testable. WebSocket/WebRTC will be introduced for voice (Phase 2) and multi-device push (Phase 5).
