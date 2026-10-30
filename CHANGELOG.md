# Changelog

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
