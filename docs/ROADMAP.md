# Roadmap

Status key: ✅ done · 🟡 partial · ⏳ next · ⬜ later

## Phase 0: bootstrap ✅ (cycle 1)
- ✅ UL-001 repo, decision log, environment diagnostics (`npm run doctor`), `.env.example`
- 🟡 UL-002 UI + gateway + tests + launch scripts ✅; Tauri shell scaffolded but **not compiled/verified**
- ✅ OpenClaw vs custom evaluation (desk review) → D-001

## Phase 1: text + memory ✅ (cycle 1)
- ✅ UL-003 provider-agnostic `ModelProvider` + deterministic mock streaming
- ✅ UL-004 persistent conversations + migrations (up/down tested)
- 🟡 UL-005 persona config ✅; Claude + OpenAI-compatible connectors built, **awaiting a live-key test**
- ✅ UL-006 memory CRUD + retrieval + provenance + citations
- ✅ UL-007 original HUD (now red, v0.12) + high-contrast/reduced-motion ✅; persona editor ✅

## Cycle 2
- ✅ **UL-008** microphone permission, push-to-talk (hold / Space / click-latch / Esc), local Whisper + OpenAI transcription, mic picker and test,
  voice transcript persistence (`inputMode`), LiveKit vs direct-provider comparison (benchmark on owner hardware still open)

## Cycle 3 (overnight 2026-10-30)
- ✅ **UL-011** local-first brain: Ollama provider, hardware detection, model recommendation, one-click download with progress,
  brain switching by voice/chat, per-brain skins; real model verified in CI

- ✅ **UL-009** spoken replies with a local natural voice (Kokoro), sentence streaming, barge-in, voice/speed/mode settings; real round trip in CI

- ✅ **UL-010** tool registry with risk levels, policy engine, approvals (chat + Activity), kill switch, reminders/timers with scheduler,
  missed-while-off handling, pop-ups/notifications/spoken reminders; tool calling for Ollama, Claude, OpenAI

- ✅ **Files / second brain**: approved folders, safe indexer (.docx, text, code), search/read tools, open-on-screen with approval, Files page

- ✅ **Hands-free wake word** (opt-in): local VAD + local Whisper, server-side wake matching, non-addressed speech discarded

- ✅ **UL-CON-001…004** connector framework (canonical events, dedupe, cursors, health, retention, disconnect-deletes), GitHub read-only
  connector, Connections page, feed, Home "What's new", `connected_updates` tool; real GitHub API contract test in CI

- ✅ **Morning briefing** tool and **Personality editor** (overrides stored in the database; safety boundaries fixed)

- ✅ **UL-CON-005** GitHub issue drafts: watched repos only, full preview with visibility, approval required, AI-assistance note

## Cycle 4–6 (2026-10-30/31): personality, conversation, smarter, PC control, phone
- ✅ v0.11 meaning-based memory recall · v0.12 red Ultron UI, companion personality, memory offers, calculator/Wikipedia/weather/web pages
- ✅ v0.13 greeting that catches up, to-do list, past-conversation search, instant commands, honesty check, tool focusing for local brains
- ✅ v0.14 conversation mode (reply without the wake word), "Talk to ULTRON" · v0.15 conversation notes, deep thinking, thinking filler,
  "what do you know about me?"
- ✅ v0.16 PC control (media keys/volume, open Start-menu apps with approval, PC status), PDFs, meaning-based file search, voice interruption
  (opt-in), prompt-injection test suite
- ✅ v0.17 phone access over Tailscale with per-device pairing, home-screen app

## Next
1. ✅ Calendar (read-only) via the private iCal link (v0.18); ⏳ Gmail/Google Calendar with OAuth once the owner creates a Google Cloud client
2. ⏳ Benchmarks on the owner's PC (time to first audio, local-brain tokens/sec, interruption reliability) to pick the default model
3. ⏳ UL-CON-005b comment/PR-review drafts; UL-CON-006 YouTube (needs the owner's Google OAuth client)
4. ⏳ Screen understanding with approval; Home Assistant; MCP skills (Phase 6)
Also queued: live-key provider validation on the owner's PC, Tauri build on Windows, usage/cost display, installer (Phase 7).

## Phase 2–7 (from the blueprint)
- ✅ Phase 2 voice + visualizer driven by real audio (push-to-talk, hands-free, conversation mode, local STT/TTS)
- ✅ Phase 3 actions: weather, reminders, read-only authorized folders, safe app launch, approvals, prompt-injection tests
- ⬜ Phase 4 Gmail (read + draft; send needs approval), Google Calendar, morning digest ✅, notifications ✅
- 🟡 Phase 5 ✅ Tailscale remote access, device pairing/revocation, home-screen app (v0.17); ⬜ cross-device sync, push notifications
- 🟡 Phase 6 ✅ opt-in wake word, ✅ local STT/TTS; ⬜ screen understanding with approval, Home Assistant, MCP skills
- ⬜ Phase 7 installer, signing, updates, restore drills, load tests

## Connected Life Hub (blueprint §17)
- ✅ UL-CON-001…005 connector framework, encrypted credentials, event store, GitHub read-only, issue drafts with approval
- ⬜ UL-CON-006 YouTube subscriptions/uploads · UL-CON-007 Reddit (only after Reddit grants API approval)
- ⬜ UL-CON-008 Discord via official bot only · UL-CON-009–011 voice/project mappings, digests, security review

## Cycle: overnight 2026-11-01 (v0.24–v0.25)
- ✅ Reliability: background service with a watchdog, crash log, update-aware launcher, Quit, quick reconnect detection
- ✅ Command-centre Home (reactor, gauges, feeds, setup checklist), HUD styling everywhere, Skills page
- ✅ Council mode: procedural wireframe face that speaks, open-mic conversation, Council voice
- ✅ Conversation: short spoken replies, early speech, trailing-off detection, 15 s reply window
- ✅ Smart home (Home Assistant) with safety tiers; read-only email (IMAP); news (BBC RSS); notes; clipboard; rain heads-up
- ✅ Prompt-injection guard: actions after untrusted text need approval
- ⏳ Next: end-of-turn detection, Outlook (OAuth), Spotify, smart-home colours/scenes by name

