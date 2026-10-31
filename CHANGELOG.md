# Changelog

## 0.18.0 · 2026-10-31 · Knows your schedule
- **Calendar (read-only)** in Connections → Calendar: paste your calendar's private iCal link (Google, Outlook, iCloud). It's checked, stored
  encrypted, and never shown again. Ask "what's on my calendar today?", "what do I have tomorrow?", "what do I have this week?" (instant),
  and your morning briefing, greetings and catch-ups now include what's coming up. Understands time zones (including daylight-saving
  changes and Outlook's zone names), repeating events (daily/weekly on chosen days/monthly incl. "second Tuesday"/yearly, with end dates
  and counts), skipped and moved occurrences, cancelled events and all-day events. Cached for 10 minutes.
- **Morning check-in:** ULTRON says good morning first, once a day at the time you choose (default 8:00, or when it starts later that
  morning; never after noon): a pop-up and Windows notification with your day at a glance and a **Brief me** button. Settings → Morning check-in.

## 0.17.0 · 2026-10-31 · ULTRON on your phone
- **Phone access over Tailscale** (Settings → Phone access): talk to ULTRON from your phone anywhere, privately. ULTRON still runs only on
  your PC; Tailscale gives it a private HTTPS address on your own devices. Each phone pairs with a 6-digit code shown on the PC (5 minutes,
  5 tries), gets its own key (the PC's key is never sent), and can be removed instantly. Changing API keys, folders, connections or other
  devices stays PC-only. Voice works on the phone too (HTTPS), and you can add ULTRON to your home screen like an app.
- Prompt-injection test suite (hostile web pages and files can't save, forget, approve or send anything).
- Tests create indexable folders outside AppData on Windows.

## 0.16.0 · 2026-10-31 · Controls your PC
- **Media and volume** (Windows): "pause the music", "next song", "skip this", "turn it up a lot", "quieter", "mute". Works with whatever
  is playing (Spotify, YouTube in the browser…). Instant, low-risk and logged.
- **Open apps:** "open Spotify", "launch Notepad", "start Visual Studio Code". ULTRON finds the app in your Start menu and shows exactly which
  shortcut it will open; nothing runs until you click Approve. Only Start-menu shortcuts can be opened this way.
- **Interrupt by voice (experimental, opt-in):** in hands-free, talk over ULTRON and it stops, cancels the rest of its reply and takes what
  you say as your answer. Only clearly loud, sustained speech counts. Best with headphones. Settings → Voice.
- **Files found by meaning:** searching your approved folders now also matches by meaning (local model, same one as memories), so "where
  did I write about the sound glitch?" finds notes about an "audio crackle". Files are prepared in the background after indexing.
- **PDFs in your second brain:** Files now indexes the text of PDFs (up to 25 MB / 300 pages; no OCR, so scanned pages without text
  aren't readable), so "find the invoice for Mike Johnson" and reading a PDF work like any other document.
- **"How's my PC doing?"** memory and disk use, battery, uptime and CPU.
- Fixed: a message sent right after "+ New conversation" (or from a Home shortcut) could land in the previous conversation.

## 0.15.0 · 2026-10-31 · Thinks harder, remembers better, never leaves you in silence
- **Deep thinking on request:** "think hard about…", "take your time", "step by step" lets the brain reason before answering (local models
  that support it think silently first; Claude uses high effort). Slower, better for hard questions. Everyday chat stays fast.
- **ULTRON reflects on your conversations:** half an hour after a chat goes quiet, ULTRON writes itself a one-or-two-sentence note about it
  (using your current brain, only while it's otherwise idle, stepping aside the moment you talk). Catching up and greetings use these notes
  ("yesterday you were fixing the audio crackle…"); hover a conversation in Chat to see its note. Passwords/ID numbers are never noted.
- **"What do you know about me?"** ULTRON reviews everything you've had it remember (sensitive items left out unless you ask) instead of
  only the memories that match your words.
- In a spoken conversation, if the brain takes more than 2.5 s to start answering, ULTRON says a short "Hmm, let me think." instead of
  leaving you in silence.

## 0.14.0 · 2026-10-31 · Just talk to it
- **Conversation mode:** in hands-free, after ULTRON answers it keeps listening for about 10 seconds, so you just reply, with no "Ultron" each
  time. Say "that's all", "goodbye" or "never mind" to end it (it still answers, then goes back to waiting for its name). On by default;
  Settings → Voice to turn it off.
- **🎙 Talk to ULTRON** button on Home: one click opens a fresh conversation that's already listening.
- Background noise that speech recognition mistakes for words ("Thank you.", "[BLANK_AUDIO]") is ignored when no wake word is required.

## 0.13.0 · 2026-10-31 · Smarter and more alive
- **ULTRON speaks first:** opening the app shows a short in-character catch-up line from your current brain (cached for 3 hours).
  Press 🔊 on it to hear it in ULTRON's voice.
- Catching up also uses memories from the last two weeks (never ones marked sensitive), so it can ask how the interview went.
- **To-do list:** "add milk and eggs to my list", "what's on my list?", "I paid the electric bill" (ticks it off; asks if it's ambiguous).
  Also on the Reminders page, and in the morning briefing.
- Conversations are titled by their first real message, not "hey Ultron".
- **Instant everyday commands:** "open github.com", "add milk and eggs to my list", "what's on my list?", "what's the weather [in X]?",
  "what's 15% of 80?" are handled directly by code, like reminders: an answer in well under a second, even when the local brain needs a minute
  to think. Anything less clear-cut still goes to the brain.
- **Remembers past conversations:** "what did we say about the Oogie release?" searches everything you and ULTRON said before
  (on this computer only). Deleting a conversation removes it from what ULTRON can recall.
- **Honesty check:** if a brain *says* it set a reminder, opened a page or requested approval but no action actually ran, ULTRON adds a
  visible correction (and logs it in Activity). Found in CI: a small local model claimed "approval requested" without asking for anything.
- **Tool focusing for local brains:** small local models get only the tools your message plausibly needs (e.g. weather words → weather tool),
  which makes them more reliable and faster. Cloud brains still see everything.
- A new message cancels a greeting that's still being written, so a busy local brain never makes you wait.
- Fixed: approving an action while ULTRON was still finishing its reply could show it as "waiting" again afterwards.
- Catching up and the greeting also know what's **coming up**: the weather at home, to-dos due today/tomorrow (or overdue) and the next reminders.

## 0.12.0 · 2026-10-30 · Red ULTRON, a real personality, and new abilities
- **Red interface** inspired by the films' Ultron (new red icon too). Local brain = red; cloud = amber; test = violet.
- **Personality:** witty, a little theatrical, warm. It banters, makes the occasional joke, asks about your projects and plans, and **catches up**
  (it knows when you last talked and what about). Spoken questions get spoken-style answers (no lists or Markdown read aloud).
  Settings → Personality → **Character** lets you rewrite how it talks.
- **Offers to remember** things you mention ("my sister's birthday is March 3"). Saved only if you click Approve; secrets are still refused.
- **New abilities:** exact calculator, Wikipedia look-ups, weather + 3-day forecast (set your **Home city** in Settings → Personality),
  and reading/summarizing a web page you link. The morning briefing now includes the weather.

## 0.11.0 · 2026-10-30 · Meaning-based memory recall (local)
- ULTRON now finds memories by *meaning*, not only shared words: "how hot should the oven be?" recalls "I bake bread at 230 degrees".
- Runs on your PC with a small local model (all-MiniLM-L6-v2, ~23 MB, downloaded once on first use). No cloud. Falls back to keyword search if the model isn't available.
- Results merge keyword and meaning matches; pinned memories always come first. Vectors are updated when a memory is edited and deleted with it.

## 0.10.1 · 2026-10-30 · Security review fixes
- Fixed an auth bypass via percent-encoded paths (`/%61pi/...`), zip-bomb .docx, unsafe "open" of programs/links/UNC paths, mid-JSON truncation,
  fuzzy "forget", voice-triggered forget/cloud switch, unlimited tool calls, DPAPI transient failures, env-secret scrubbing. See SECURITY.md.

## 0.10.0 · 2026-10-30 · GitHub issue drafts with approval
- `github_create_issue` (L2): watched repos only; approval card shows service, repo, public/private, title and full text; AI-assisted footer; clear message for read-only tokens.
- Approval cards can show a full preview of what will be sent.

## 0.9.3 · 2026-10-30 · Faster voice, faster local connections
- Kokoro now uses fp16 by default: ~2× faster than the old 8-bit model on CPU (benchmarked in CI on Windows and Linux), so speech doesn't pause between sentences.
- ULTRON listens on both loopback addresses (127.0.0.1 and ::1), avoiding slow "localhost" fallbacks on Windows.
- The launcher waits up to 2 minutes for a slow first start before opening the window.

## 0.9.2 · 2026-10-30 · Windows conveniences
- ULTRON icon (.ico) generated from the logo; Settings → Windows: desktop shortcut and start-at-sign-in (background mode).
- `Start-ULTRON.bat --background` starts ULTRON without opening a window.
- CI now runs the real Windows launcher and checks ULTRON comes online and serves the interface.

## 0.9.1 · 2026-10-30 · Security: secrets encrypted at rest on Windows
- API keys and connector tokens are encrypted with Windows DPAPI (current user). Old plain files upgrade automatically; undecryptable files are set aside with a clear Home warning.

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
