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
- 🟡 UL-007 original cyan HUD + high-contrast/reduced-motion ✅; persona editor UI pending

## Cycle 2
- ✅ **UL-008** microphone permission, push-to-talk (hold / Space / click-latch / Esc), local Whisper + OpenAI transcription, mic picker and test,
  voice transcript persistence (`inputMode`), LiveKit vs direct-provider comparison (benchmark on owner hardware still open)

## Cycle 3 (overnight 2026-10-30)
- ✅ **UL-011** local-first brain: Ollama provider, hardware detection, model recommendation, one-click download with progress,
  brain switching by voice/chat, per-brain skins; real model verified in CI

- ✅ **UL-009** spoken replies with a local natural voice (Kokoro), sentence streaming, barge-in, voice/speed/mode settings; real round trip in CI

- ✅ **UL-010** tool registry with risk levels, policy engine, approvals (chat + Activity), kill switch, reminders/timers with scheduler,
  missed-while-off handling, pop-ups/notifications/spoken reminders; tool calling for Ollama, Claude, OpenAI

## Next
1. ⏳ **UL-010** tool policy registry (risk levels L0–L3, approval modal), clock + reminders with a real scheduler, audit integration
3. ⏳ Voice benchmark on the owner's PC (time to transcript / first audio, interruption reliability)
Also queued: live-key provider validation on the owner's PC, Tauri build on Windows, persona editor, usage/cost display.

## Phase 2–7 (from the blueprint)
- ⬜ Phase 2 voice + visualizer driven by real audio
- ⬜ Phase 3 actions: weather, reminders, read-only authorized folders, safe app launch, approvals, prompt-injection tests
- ⬜ Phase 4 Gmail (read + draft; send needs approval), Google Calendar, morning digest, notifications
- ⬜ Phase 5 Tailscale remote access, device pairing/revocation, PWA, cross-device sync
- ⬜ Phase 6 opt-in wake word, local STT/TTS, screen understanding with approval, Home Assistant, MCP skills
- ⬜ Phase 7 installer, signing, updates, restore drills, load tests

## Connected Life Hub (blueprint §17), after MVP tests pass
- ⬜ UL-CON-001 connector interfaces, event/action schemas, encrypted credentials, migration
- ⬜ UL-CON-002 Connected Accounts settings UI · UL-CON-003 event store, dedupe/cursors, retention
- ⬜ UL-CON-004/005 GitHub read-only, then drafts + approvals
- ⬜ UL-CON-006 YouTube subscriptions/uploads · UL-CON-007 Reddit (only after Reddit grants API approval)
- ⬜ UL-CON-008 Discord via official bot only · UL-CON-009–011 voice/project mappings, digests, security review
