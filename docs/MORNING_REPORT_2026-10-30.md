# Overnight build report (Oct 30, 2026, 1:50 a.m. → 7 a.m.)

You asked for ULTRON to run **truly locally**, inspired by the "Jarvis" video, and gave me the night with no approvals.
ULTRON went from v0.2 to **v0.11**. Everything below is pushed to **github.com/Pallypots/Project-ULTRON**.

## The headline
ULTRON's brain, ears, voice and memory can now all run **on your own PC with no cloud and no internet** (after one-time downloads).
Cloud brains (Claude, OpenAI) are optional extras you can switch to by voice, never a requirement.

| | Before tonight | Now |
|---|---|---|
| Brain | cloud (or fiddly local) | **Local AI via Ollama**: detects your graphics card, recommends a model, one-click download. "Switch your brain to local / Fable / test" by voice, with a color skin per brain |
| Ears | push-to-talk, local Whisper | + **Hands-free mode**: say "Ultron, …" with no button (opt-in; anything else is discarded unheard) |
| Voice | none | **Spoken replies** generated on your PC (Kokoro, British "George" by default), sentence by sentence; interrupt by talking, Esc or Stop |
| Actions | none | Reminders & timers (pop-up + Windows notification + spoken), open websites, open files: **anything with an outside effect waits for your Approve click** |
| Second brain | none | **Files**: add folders; ULTRON searches/reads them ("pull up the free school community"). Secrets and system folders are always skipped |
| Connected accounts | none | **GitHub** (read-only feed of your repos + "what's new?") and **issue drafts you approve before posting** |
| Daily use | — | **"Good morning" briefing**, **Personality editor** (e.g. call you "sir"), desktop icon, start-at-sign-in |
| Memory | keyword matching | + **recall by meaning** with a small local model: "how hot should the oven be?" finds "I bake bread at 230 degrees" |
| Security | keys in a plain file | keys **encrypted with Windows DPAPI**; independent security review found 8 issues, **all fixed** with tests (see SECURITY.md) |

## Proof (real tests, not mock-ups)
Every push runs on GitHub's **Windows and Linux** machines. Real results recorded tonight:

| Test | Result |
|---|---|
| **Local brain** `gemma4:e2b` via Ollama (Linux CI): "capital of France?" | "The capital of France is Paris." |
| Local brain asked to open a website | Chose the tool on its own, **waited for approval**, and said so honestly: "I've queued up opening https://example.com, but I need your approval…" |
| **Local voice → local ears**: Kokoro speaks, Whisper listens (Windows + Linux) | word-perfect: "good evening, the reactor is stable and all systems are running locally." |
| Whisper on the JFK clip (Windows + Linux) | word-perfect, ~2.4 s for 11 s of audio |
| **GitHub connector against your real repo** | found 20 commits and the 4 failed CI runs from earlier tonight |
| **`Start-ULTRON.bat` on real Windows** | brought ULTRON online and served the interface |
| **Meaning-based memory recall** with the real local model (Linux CI) | "how should recipes mention warming the oven?" → *"I prefer instructions that say whether preheating is needed"*; "when is my sibling's special day?" → *"My sister's birthday is March 3"* (no shared keywords; ~1.6 s including model load) |
| DPAPI key encryption, desktop/start-up shortcuts (Windows) | pass |
| Automated tests | **163 passed** (+7 real-model tests that run in CI) |
| Browser end-to-end test (real Chromium, fake microphone) | **39 steps** pass on Windows and Linux |

Speed note from CI (basic 4-core machines, no graphics card): the voice now generates faster than real time (fp16 Kokoro, ~0.8×; it was 1.4–2× before I benchmarked).
The small local brain took ~45–80 s per answer **on those weak machines**. Your PC with a graphics card should be far faster, but that's the first thing to measure.

## Try it this morning (about 15 minutes)
1. **Update ULTRON.** On github.com/Pallypots/Project-ULTRON → **Code → Download ZIP**, extract over your old folder (your data is safe in `%APPDATA%\ULTRON`).
   Or, if you installed Git: `git pull` in the folder. Then double-click **Start-ULTRON.bat**.
2. **Give it a local brain.** Install **Ollama** from https://ollama.com/download. In ULTRON: **Settings → Language model → Local AI on this PC**.
   It shows your graphics card and recommends a model. Click **Download**, then **Use this brain**. (Or say "switch your brain to local".)
3. **Voice.** Settings → Voice → **Download speech model now**; Settings → Spoken replies → **Download voice now** → **Preview voice**.
4. **Try these** (type, hold Talk, or turn on 🎧 Hands-free and start with "Ultron,"):
   - "Good morning, brief me" · "What can you do right now?"
   - "Remind me in 10 minutes to stretch" · "Set a timer for 3 minutes"
   - "Remember that my main project is the Oogie's Revenge PC port"
   - "Switch your brain to local" / "go offline"
   - "Open https://github.com" (then click **Approve**)
5. **Optional:**
   - **Files** → add your projects folder → "pull up my build logs".
   - **Connections → GitHub** (follow the 3 steps for a read-only token) → choose repos → "what's new on GitHub?"
   - **Settings → Personality** → "How it addresses you: sir".
   - **Settings → Windows** → desktop icon / start at sign-in.

## What still needs you
- **Run it on your PC with a real microphone and speakers.** CI uses a simulated microphone and can't hear the voice.
- **Tell me how fast the local brain answers** on your desktop and laptop (and which graphics card each has). That decides the best default model.
- **GitHub token** (optional), only if you want the GitHub feed or issue drafts. It's entered in the app, never in chat.
- **YouTube** needs a Google Cloud OAuth client you create once (I'll walk you through it); **Reddit** needs Reddit's API approval for your account; **Discord** needs a bot invited to your server.

## Honest limitations
- Hands-free and the local brain use more CPU than push-to-talk and cloud models; very slow PCs may feel sluggish.
- Hands-free can't be interrupted *by voice* while ULTRON is speaking (Esc, Stop or Talk work).
- ULTRON only does things while it's running (reminders missed while it was off are shown as "missed").
- No phone access yet (Phase 5); everything is on this PC only.
- The Tauri desktop shell is still unbuilt; ULTRON opens in an Edge app window, which works well.

## What's next (my suggestion)
1. Measure on your hardware and tune the default local model and voice.
2. YouTube connector (needs your Google OAuth client) and phone access over Tailscale (secure, private).
3. Meaning-based search for *files* too (memories already have it), PDF text in Files.

Full details: [CHANGELOG](../CHANGELOG.md) · [User guide](USER_GUIDE.md) · [Decisions](DECISIONS.md) · [Testing](TESTING.md) · [Security](../SECURITY.md)
