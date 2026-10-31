# Testing

```bash
npm test            # 49 unit + API integration tests, mock provider, no network or keys
npm run lint        # TypeScript strict type check
npm run build && npm run test:e2e   # real Chromium against the real built app; writes docs/screenshots/*.png
```
CI (`.github/workflows/ci.yml`) runs lint, tests, build and doctor on **windows-latest** and ubuntu-latest.

## What's covered
| Area | Tests |
|---|---|
| Migrations | apply → full rollback → re-apply; idempotent |
| Persistence | conversation survives DB close/reopen; interrupted streaming reply recovered as cancelled |
| Memory | provenance stored; relevance search; edit reindexes; hard delete removes row + FTS entry; pinned always retrieved; FTS syntax injection neutralised |
| Intents | 8 remember/forget/chat phrasings; credentials/cards/keys/SSN refused; sensitive flagged |
| Persona | config loads; prompt includes live capabilities, memory citations, boundaries |
| Security | 401 without/with wrong token; 403 for foreign Host or Origin; health leaks nothing; API key never in responses, activity, logs or log export; token never in logs |
| Chat | streaming events order; both messages persisted; unconfigured provider gives a clear error; **100 consecutive requests**; input validation |
| **Phase 1 acceptance** | "Remember…" → gateway restart → new conversation recalls with citation → edit stops old match → delete stops retrieval → audit shows all three |
| Audio | WAV round-trip, stereo downmix + 48→16 kHz resample, real speech fixture decode, garbage/unsupported rejection |
| Voice API | transcribe with engine, token required, 415/400/422/413 for non-audio/too-short/silent/too-long, audit has no words, engine status/privacy/settings, `inputMode` persisted |
| Real Whisper (CI only, `ULTRON_TEST_WHISPER=1`) | downloads `Xenova/whisper-base.en`, transcribes the JFK sample, asserts "ask not what your country can do for you…" |
| E2E voice (fake mic playing the JFK sample) | mic test meter moves; hold-to-talk captures real audio and sends a voice message; hold Space; Esc discards; click-latch; review mode fills the box; activity logs mic use; blocked mic shows a fix |
| Local AI | Ollama provider streaming, `think:false`, `<think>` text hidden, retry without `think`, plain-English errors; hardware → model table; integrated GPUs ignored; brain-switch intents (and non-intents); brain resolution with/without keys; status, download progress, bad names, use-before-download refused, switching by chat |
| Real local brain (CI Linux, `ULTRON_TEST_OLLAMA=1`) | installs Ollama, downloads `gemma4:e2b`, "switch your brain to local", asks a question, expects "Paris" and no thinking tags |
| E2E local brain (fake Ollama) | Local AI panel detects engine + hardware, downloads with progress, Use it → cyan skin + status pill; local reply; test ↔ local switching changes skins; cloud refused without key |
| Spoken replies | `toSpeakable` cleanup, streaming `SentenceSplitter`, speak API (WAV, 204 for nothing to say, validation, browser-engine 409, token), capability text |
| Real voice round trip (CI, `ULTRON_TEST_TTS=1`) | Kokoro speaks a sentence → resample → Whisper transcribes → key words must match |
| E2E spoken replies (test tone) | voice message reply is spoken; Talk/Space interrupts instantly; Esc stops speech; Settings preview plays and stops |
| Time parsing | durations, clock times (am/pm/24h/noon/tomorrow/tonight), reminder phrasings in both orders, timers, list/cancel, non-commands ignored |
| Actions | policy matrix; read-only tool result fed back; website open waits for approval, runs once, double-approve refused, chat bubble synced; deny / Stop all / kill switch; unknown tool, invalid input, `javascript:`/`file:` URLs rejected; approval-looking text can't approve |
| Reminders | set/list/cancel via chat, live `reminder_fired` event over `/api/events`, missed-while-off, input validation |
| E2E actions | 3-second timer pops up; website action shows Approve and runs only after the click; Reminders page add/cancel; Activity table |
| Files | .docx text, chunking; indexes names/contents; skips `.env`, password files, hidden, `node_modules`, binary; incremental re-index and deletion; folder validation (relative, drive root, home, system, data dir, missing); owner search/open; brain search; read only via indexed ids; `..` traversal and symlink escape blocked; open needs approval; removing a folder removes its index |
| E2E files | system folder refused; project folder indexed; search; secret never indexed; "pull up …" in chat uses `search_files` |
| Wake word | variants and mishearings at utterance start, fillers ("hey", "ok"), name mid-sentence ignored, custom names |
| Hands-free API | non-addressed speech returns `{addressed:false}` and leaves no trace in Activity; addressed returns only the command; refused with cloud STT; on/off audited |
| E2E hands-free | toggle on → fake-mic speech prefixed "Ultron," becomes a voice message (wake word stripped) and gets a reply; toggle off; Activity entry |
| Connectors | GitHub event mapping (first-line titles, failed runs urgent), bad token / rate limit / unknown repo errors, connect read test, repo validation, sync + dedupe on re-sync, Important filter, rate-limit backoff keeps last good sync, brain gets feed status, hostile issue title stays data, disconnect deletes token + events |
| Knowledge tools | calculator precedence/percent/functions and rejection of non-maths; Wikipedia found/not found; weather for a place, home city, unknown place, in the briefing; web page text extraction, redirects, non-HTML refused; private/loopback/link-local/IPv6 addresses refused; owner-typed links read directly, model-picked links need approval |
| Real web (CI, `ULTRON_TEST_WEB=1`) | live Wikipedia ("Ada Lovelace"), live Open-Meteo weather for Boston in °F with a 3-day forecast, reads example.com |
| Real local brain extras (CI Linux) | informational: does gemma4 use the calculator for 1299 × 0.85 + 4.99, and what does its personality sound like ("I'm back, tell me a joke") |
| Memory offers & personality | proposal waits for approval, saved once (duplicates detected), secrets refused even if approved; prompt contains companion/humour/catch-up/spoken-style rules; humour off removes jokes; character text editable and reset |
| Past conversations | finds the owner's words in another conversation with highlighted matches; ignores unrelated chats and the current one; deleted conversation can't be recalled (index triggers) |
| To-do list | several items from one sentence; duplicates skipped; list; tick off by description; ambiguous → candidates, no change; no match; app add/edit/tick/delete with validation; in briefing; paused actions block changes but not reading; E2E add by chat → tick in app |
| Conversation notes | quiet conversations with ≥4 messages get one note, re-noted after new messages, skipped while busy; catch-up uses notes with "when"; cancelled mid-note when the owner talks (fake hanging local brain) |
| Conversation mode | noise "words" ignored, wrap-up phrases detected (and not mid-sentence); E2E: after a hands-free answer the follow-up window opens and the next phrase is sent without a wake-word check; "Talk to ULTRON" on Home listens straight away |
| Voice interruption | E2E (simulated mic, opt-in on): while ULTRON speaks in hands-free, loud speech stops it and the next words become the reply; off by default so earlier voice steps are unaffected |
| Meaning-based file search | leading chunks embedded once, re-embedded when a file changes, vectors removed with the folder; search merges word and meaning matches. Real model (CI): "sound glitch in the game" finds the file about an "audio crackle" that keyword search misses |
| PDFs | text extracted from a generated PDF; broken/non-PDF files return nothing; a PDF in an approved folder is found by search and readable |
| PC control | Start-menu app discovery (subfolders, uninstallers and non-shortcuts skipped), fuzzy/initials matching, "open X" asks with the exact shortcut and runs only after approval, unknown apps go to the brain; media command parsing; Windows-only media keys report honestly elsewhere; PC status. Real Windows CI: real Start menu, battery/disk, media keys actually sent (mute twice). E2E: "open notepad" card + approve |
| Quick commands | parser accepts open/add/list/weather/maths commands (with "Ultron," and "please") and rejects ambiguous ones; chat replies built from tool results (exact maths, weather sentence with umbrella hint, list, duplicates), approval still required for opening sites, errors in plain English |
| Tool focusing & honesty check | keyword groups pick the right tools (reminders, maths, weather, web, to-do, memory), none for small talk, follow-ups keep the previous message's tools; claim detector true/false examples; a claimed-but-not-done action gets a visible correction and an audit entry, a real action doesn't |
| Greeting & catch-up | first-run introduction; "welcome back" names the last conversation; cached; recent memories (14 days, never sensitive) reach the prompt; E2E: greeting card on Home |
| E2E memory offer | "my sister's birthday is March 3" → approval card shows exactly what will be saved → Approve → appears in Memory Vault |
| Embeddings | vectors stored, refreshed after edits, dropped on delete; hybrid merge with keyword search; off mode = keyword only |
| Real meaning-based recall (CI, `ULTRON_TEST_EMBED=1`) | downloads all-MiniLM-L6-v2; "how hot should the oven be?" must recall the bread-baking memory, which shares no keywords |
| Real GitHub (CI, `ULTRON_TEST_GITHUB=1`) | syncs this repository with the Actions read-only token; checks event shapes and links |
| E2E connections (fake GitHub) | bad token refused; connect; choose repo; feed; Important filter; "what's new on github?" tool; disconnect clears feed |
| Personality & briefing | overrides saved/applied (prompt, wake words, status), reset; invalid wake words, out-of-range tone, editing boundaries and HTML names rejected; briefing includes reminders, pending approvals, "github not connected", unconnected calendar/weather |
| E2E personality & briefing | salutation saved → Home says ", sir."; "Good morning, brief me" runs `daily_briefing` and reports unconnected sources; reset |
| Windows (CI only) | DPAPI secrets round-trip with no plaintext on disk; shortcuts created/removed; `Start-ULTRON.bat --background` brings ULTRON online and serves the interface |
| GitHub drafts | preview shows repo/visibility/title/AI note; nothing posted before approval; posted after; unwatched repo refused; read-only token explained |
| E2E (browser) | home online, remember in chat, recall in new conversation with citation tag, survives reload, vault delete, activity entry, accessibility toggles, phone width, offline banner after service stops |

## Results, 2026-10-30, cycle 2 (Linux cloud container, Node 22.22, Chromium via Playwright)
- `npm test`: **49 passed, 1 skipped** (the real-Whisper test is skipped there because Hugging Face is blocked; it runs in CI)
- `npm run test:e2e`: **17/17 steps passed**
- `npm run lint`: clean · `npm run build`: OK · `npm run doctor`: all checks pass

## Results, GitHub Actions CI (windows-latest and ubuntu-latest, Node 22)
- Lint, 49 tests + **real Whisper test**, build, doctor, **17-step browser E2E**: all passed on both OSes.
- Real local Whisper (`Xenova/whisper-base.en`, CPU) on the 11.0 s JFK sample:

| OS | Model load (cached) | Transcription time | Output |
|---|---|---|---|
| Windows | 1.6 s | 2.4 s | "And so my fellow Americans ask not what your country can do for you, ask what you can do for your country." |
| Linux | 1.8 s | 2.3 s | identical |

These are cloud CI machines, not the owner's PC. Expect different numbers on your hardware; the first ever use also includes the one-time download.

## Not yet verified
- The Edge app window opening on a real desktop (CI runs the launcher in background mode on Windows and checks ULTRON serves the UI; the owner has also launched it successfully on Windows).
- Real microphone hardware and Edge's permission prompt on the owner's PC (E2E uses Chromium's fake microphone).
- Real Claude/OpenAI/Ollama calls (no keys in the dev environment). Use Settings → **Test connection**.
- Tauri shell build.

## Manual Windows validation checklist
1. Double-click `Start-ULTRON.bat` → ULTRON window opens, shows **Online**.
2. Chat: "Remember that I prefer short answers" → "Saved to Memory Vault" tag.
3. Close the launcher window → UI shows "isn't responding". Start again → old conversation is still there.
4. New conversation: "How long should your answers be?" → memory tag appears under the reply.
5. Memory Vault → Forget → ask again → no memory tag.
6. Settings → choose Claude, paste key, Save, Test connection → "Connected to anthropic / claude-opus-5-5 in … ms".
7. `npm run doctor` and `npm run backup` both succeed.
8. Settings → Voice → Download speech model now → reaches "Ready". Test microphone → bar moves.
9. Chat → hold Talk, say "Remember that my favourite colour is teal", release → transcript appears as a 🎙 voice message and the memory is saved.
