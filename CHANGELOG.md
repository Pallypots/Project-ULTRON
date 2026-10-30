# Changelog

## 0.9.0 · 2026-10-30 · Cycle 3: morning briefing, personality editor
- `daily_briefing` tool: today's reminders, missed reminders, pending approvals, GitHub highlights; explicitly lists unconnected sources.
- Settings → Personality: name, salutation, wake words, humor/sarcasm/formality sliders, verbosity; reset; boundaries not editable. Home greets you by your salutation.
- Questions from Home or a feed card open a fresh conversation (no more "still answering" collisions).
- CI: longer step timeouts for slower Windows runners; failures reported as annotations.

## 0.8.0 · 2026-10-30 · Cycle 3: Connected Life Hub v1 (GitHub read-only)
- Connector framework: canonical event schema with dedupe keys, urgency and "why surfaced", per-account cursor/health, 30-day retention, capability flags.
- GitHub connector (fine-grained token, read-only): commits, PRs, issues, failed workflow runs, releases for chosen repos; rate-limit backoff; 15-minute sync.
- Connections page (guided token setup, repo picker, Sync now, Disconnect deletes all data), feed with All/Important, Home "What's new", "Ask ULTRON" from a card.
- `connected_updates` tool reports real feed status per source (never invents counts); hostile titles stay data.
- Migration 5: `integrations`, `connector_events`.
- Tests: fake GitHub API, mapping/dedupe/cursor/rate limit/bad token/disconnect, 3 browser steps; CI contract test against the real GitHub API.

## 0.7.0 · 2026-10-30 · Cycle 3: hands-free wake word
- Opt-in Hands-free mode in Chat: voice-activity detection cuts phrases; on-PC Whisper transcribes; "Ultron, …" (and common mishearings) wakes ULTRON;
  "Ultron" alone opens an 8-second follow-up window. Non-addressed speech is dropped on the server, never returned or logged.
- Refused with cloud speech recognition; pauses while ULTRON speaks; on/off recorded in Activity; clear green indicator with live level.
- Fix: pressing Enter right after "New conversation" could send to the previous conversation.
- Tests: 13 wake-word cases, server wake-mode privacy tests, 2 browser steps (fake microphone).

## 0.6.0 · 2026-10-30 · Cycle 3: local files ("second brain")
- Approve folders on the Files page; ULTRON indexes names and text contents (plus Word .docx) locally with incremental re-scans.
- Tools: `search_files` and `read_file` (read-only, approved folders only, content passed as untrusted data); `open_on_screen` (needs approval).
- Safety: refuses drives/home/system/credential/ULTRON folders; skips hidden folders, dependencies, symlinks and secret files; path checks on every read/open.
- Files page: add/remove/re-scan folders, search, one-click open.
- Migration 4: `folders`, `documents`, `document_chunks` (FTS5).
- Tests: docx extraction, indexing/skipping rules, incremental re-index, folder validation, traversal/symlink escape, approval for opening; 2 browser steps.
- CI evidence: the real local model (gemma4:e2b) chose a tool, waited for approval and said so honestly.

## 0.5.0 · 2026-10-30 · Cycle 3: UL-010 actions, approvals, reminders
- Tool calling for local (Ollama), Claude and OpenAI brains; capped model ↔ tools loop; honest "waiting for approval" reporting.
- Tools: current time (L0), create/list/cancel reminders (L1/L0), open a website (L2, approval required). L3 blocked.
- Policy engine with approvals (chat chips and Activity), 10-minute expiry, kill switch, "ask before low-risk" option; Stop all cancels pending approvals.
- Reminders and timers by voice/text (deterministic parser), scheduler, live event stream, pop-ups, Windows notifications, spoken reminders, Reminders page, missed-while-off.
- Activity page lists every action with risk and who asked.
- Migration 3: `tool_executions`, `reminders`, `messages.tool_events`.
- Tests: 38 time-parsing cases, policy/approval/kill-switch/prompt-injection tests, live reminder event, 4 new browser steps; CI logs whether the real local model uses tools.

## 0.4.0 · 2026-10-30 · Cycle 3: UL-009 spoken replies (local voice)
- Kokoro natural voices generated on the PC (default "George", British), one-time ~90 MB download with progress; Windows built-in voices as fallback.
- Replies to voice messages are spoken sentence by sentence while the text streams; "always/never" options; speed control; voice preview.
- Barge-in: Talk/Space, Esc, Stop, or a new message silences ULTRON instantly; HUD core animates to the real speech level.
- Fix: messages written in the same millisecond could load out of order.
- Tests: speech text cleanup and sentence splitting, speak API, browser barge-in steps; CI runs a real Kokoro → Whisper round trip.

## 0.3.0 · 2026-10-30 · Cycle 3: UL-011 local-first brain
- Local AI via Ollama: native streaming chat with thinking disabled/hidden, clear errors for "not running" / "model not downloaded".
- Hardware detection (nvidia-smi; Windows display-adapter registry for true VRAM) and a model recommendation per machine.
- Settings → Local AI panel: engine status, hardware, recommended model, one-click download with progress/cancel, installed models, use any library tag.
- Brain switching by chat/voice ("switch your brain to local", "go offline", "switch to Fable") with honest refusals; audited.
- Brain skins: cyan = local, amber = cloud, violet = test; status pill shows where the brain runs.
- Fixes: nested form in Settings submitted the page; Settings initial load could override a choice; late conversation load could jump back to an old chat.
- Tests: fake Ollama server, 18 new unit/API tests, 4 new browser steps; CI runs a real `gemma4:e2b` chat on Linux and the hardware probe on Windows.

## 0.2.0 · 2026-10-30 · Dev cycle 2: UL-008 voice input
- Push-to-talk in Chat: hold the Talk button or Space, click-to-latch hands-free, Esc to cancel; live listening bar, timer and level meter; HUD core reacts to voice level.
- Speech recognition engines: local Whisper on the PC (default, free, private), OpenAI transcription, test engine. One-time model download with progress.
- Settings → Voice: engine/model, microphone picker that follows device changes, mic test meter, send-immediately vs review-first.
- Voice messages are stored as text marked `inputMode: voice` (migration 2). Audio is never stored; the audit log records mic use without content.
- Plain-English errors for blocked/missing/busy microphones, silent or too-short recordings.
- New `@ultron/audio` package; voice API tests; real-Whisper test and browser E2E (fake microphone) in Windows + Linux CI.
- Docs: VOICE.md with the LiveKit vs direct-realtime comparison.

## 0.1.0 · 2026-10-30 · Dev cycle 1 (Phase 0 + Phase 1)
- Monorepo: gateway (Fastify), React UI, shared schemas, agent core, persistence.
- Streaming chat over SSE with persistent conversations, crash recovery of interrupted replies, stop/kill switch.
- Explicit memory: "Remember…/Forget…" in chat, Memory Vault (edit/pin/export/forget), BM25 retrieval with provenance and citations, sensitive-data refusal.
- Providers: deterministic mock, Claude (Anthropic SDK, streaming, refusal fallbacks), OpenAI-compatible (OpenAI, Ollama, LM Studio).
- Version-controlled persona (`config/persona.json`) and honest live capability reporting.
- Original cyan HUD UI with animated core, high-contrast and reduced-motion modes, phone-width layout, offline banner.
- Security: loopback-only, Host/Origin checks, bearer token, secret redaction in logs and audit trail.
- Tooling: `Start-ULTRON.bat` launcher, `doctor`, `backup`, `dev`, unit/integration tests, browser E2E with screenshots, Windows + Linux CI.
- OpenClaw evaluation and decision log.
