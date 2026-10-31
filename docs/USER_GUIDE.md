# ULTRON user guide

## Talking to ULTRON
Open **Chat**, type, press **Enter**. **Shift+Enter** adds a new line. **Esc** or **Stop** cancels a reply mid-sentence.
**Stop all** (bottom-left, every screen) cancels everything ULTRON is doing.

## Talking to ULTRON (push-to-talk)
- **Hold** the 🎙 **Talk** button and speak; let go to send. Or click somewhere that isn't a text box and **hold Space**.
- **Click** Talk once to go hands-free, click again when you're done. **Esc** throws the recording away.
- The microphone is on only while the red **Listening** bar is showing. Recordings are never saved, only the text.
- First time: Windows/Edge asks for microphone permission. Allow it. Speech recognition runs **on your PC**; the first use downloads a speech model once
  (Settings → Voice → "Download speech model now" does it ahead of time).
- Wrong mic? Settings → Voice → pick it, then **Test microphone**: the bar should move when you talk.
- Prefer to check the words first? Turn off "Send right after I stop talking"; the transcript appears in the message box for editing.

## ULTRON talking back
- By default ULTRON reads its reply aloud **when you spoke to it** (Settings → Spoken replies: "always" or "never" also available).
- It starts speaking after the first sentence, not after the whole reply.
- **Interrupt it** any time: press Talk / hold Space (it stops and listens), press **Esc**, or click **Stop speaking**.
- Voices run **on your PC** (Kokoro; ~165 MB one-time download). Default is "George" (British). "Heart" (American) is the highest-rated.
  Change voice and speed in Settings → Spoken replies, and use **Preview voice** to hear it. Windows' built-in voices are a no-download fallback.

## Reminders and timers
Say or type things like:
- "remind me in 20 minutes to take the pizza out" · "remind me at 5pm to call mom" · "remind me tomorrow at 9 to send the invoice"
- "set a timer for 10 minutes" · "what are my reminders?" · "cancel my reminder to call mom"

When one is due, ULTRON shows a pop-up, a Windows notification (turn it on in Settings → Actions) and says it out loud. Reminders only fire while ULTRON is
running; anything that came due while it was off is listed as **missed** on the Reminders page. You can also add or cancel reminders there.

## What ULTRON can do on its own (actions)
| Kind | Examples | What happens |
|---|---|---|
| Read-only | check the time, list reminders | just happens |
| Low-risk, undoable | set/cancel a reminder | happens and is logged (Settings → Actions can make it ask first) |
| Outside effect | open a website in your browser | **waits for you to click Approve** (in chat or Activity); expires after 10 minutes |
| High-risk | money, deleting, security settings | blocked |

Saying "yes" out loud never approves anything; only a click does. **Pause all actions** in Settings is the kill switch, and **Stop all** also cancels anything waiting for approval.
Every action is listed in **Activity** with who asked for it and what happened.

## Files: ULTRON's "second brain"
(Reads text, code, Word documents and PDFs. Scanned PDFs that are only pictures can't be read yet.)
1. Open **Files** and paste a folder path (copy it from File Explorer's address bar), e.g. `C:\Users\you\Documents\Projects`. Click **Add folder**.
2. ULTRON indexes it on your PC (names of all files; contents of text, code, CSV, Markdown and Word .docx files). It re-scans at startup and every 30 minutes, or click **Re-scan**.
3. Ask things like "pull up the free school community", "what does my build log say about the shader cache?", "find my invoice for Mike Johnson".

ULTRON can only see folders you added. It always skips hidden folders, system folders, `node_modules`, and secrets (`.env`, key files, password files).
It can read files to answer you, but opening something on your screen needs your Approve click. **Remove** a folder to delete its index (your files are untouched).

## Just talk: conversation mode
Click **🎙 Talk to ULTRON** on Home (or turn on 🎧 Hands-free in Chat and say "Ultron, …"). After each answer, ULTRON keeps listening
for about 10 seconds, so you can simply reply, like a normal conversation. The bar under the chat says **"Conversation · I'm listening"**
while it waits. Say **"that's all"**, "goodbye" or "never mind" to wrap up; after that it only responds to "Ultron, …" again.
Turn conversation mode off in Settings → Voice if you prefer to say the name every time.

**Interrupting by voice (experimental):** turn on Settings → Voice → "Interrupt by voice", then in hands-free you can simply talk over
ULTRON: it stops and listens. It needs you to speak clearly louder than its voice; with headphones it works best. With loud speakers
it might occasionally interrupt itself, which is why it's off by default.

## Hands-free mode ("Ultron, …")
Click **🎧 Hands-free** in Chat. A green bar shows whenever it's on. Start what you say with **"Ultron"**: "Ultron, set a timer for ten minutes",
or just "Ultron" and then your request. Anything that doesn't start with ULTRON's name is thrown away immediately: not saved, not shown, not sent anywhere.
- It works only with speech recognition on this PC (not the cloud option), and it pauses while ULTRON is talking so it can't trigger itself.
- Turning it on and off is recorded in Activity. It stays on while the Chat screen is open; click **Turn off** (or the button again) to stop.
- To interrupt ULTRON while it's talking, press Esc, Stop, or Talk.
- Noisy rooms use more processor time (every phrase is checked). Push-to-talk is the lighter option.

## Connections: GitHub (read-only)
1. Open **Connections** and follow the three steps to create a **fine-grained token** on GitHub: only the repos you want, and **Read-only** for Contents,
   Issues, Pull requests and Actions. Paste it into ULTRON (never into chat). ULTRON tests it before saying "connected".
2. **Choose repos** → **Save & sync**. ULTRON checks every 15 minutes while it's running (or click **Sync now**).
3. Ask "what's new on GitHub?", "catch me up", or "did any builds fail?". Or read the **Feed** (filter **Important** for failures, PRs, issues and releases).
   **Ask ULTRON** on a card starts a chat about it; **Open source** opens it on GitHub.

**Drafting issues:** say "draft an issue in pallypots/oogie-port: crash when loading the boss arena". ULTRON writes the issue and shows you
exactly what would be posted (repo, public/private, title, text). Nothing is posted until you click **Approve**. Posted issues end with a short
"drafted with ULTRON (AI-assisted)" note. ULTRON can only post to repos you watch, and your token needs **Issues: Read and write** for those repos
(edit the token on GitHub if you want this; read-only tokens just get a clear message).

ULTRON stores titles and links only (no code or issue bodies) and deletes them after 30 days. **Disconnect** deletes the token and everything it stored.
YouTube, Reddit and Discord are listed as "coming next" with what each needs.

## Windows conveniences
Settings → **Windows**: **Add ULTRON icon to the desktop** (double-click it to start ULTRON), and **Start ULTRON when I sign in** (starts quietly in
the background so reminders and GitHub updates keep working; open it from the desktop icon).

## Morning check-in
Each morning at the time you choose (Settings → Morning check-in, default 8:00), ULTRON pops up first: "Good morning. Today: 3 events, first:
Standup, 1 to-do due." Click **Brief me** for the full briefing. If ULTRON starts later that morning it checks in then; never after noon.

**Evening check-in:** at 9 p.m. by default ULTRON asks how your day went. Click **Talk** and just tell it; it may offer to remember
the highlights. Turn either check-in off or change the times in Settings → Check-ins.

## Good morning briefing
Say "Ultron, good morning", "brief me" or "what's my day like?" (or tap **Good morning, brief me** on Home). ULTRON gathers today's reminders,
anything missed while it was off, actions waiting for your approval, and GitHub highlights from the last 24 hours. It tells you plainly which sources
aren't connected (calendar, email, weather…) instead of guessing.

## Personality
ULTRON has a character: witty, a little theatrical, warm, and curious about your life. It jokes back, asks about your projects, and when you say
"hey" or "catch me up" it picks up where you left off. If you're stressed or in a hurry it drops the jokes. When you talk to it by voice it answers
in a spoken style. When you open the app after a while, ULTRON greets you first on the Home screen with a line about what's been going on
(on a slow PC this can take a minute to appear). Change any of it in Settings → **Personality** (the **Character** box is plain English: "talks like a pirate" works).

## Hard questions: "think hard about…"
Start with "think hard about…", "take your time" or "walk me through it step by step" and ULTRON reasons carefully before answering (it takes
longer, especially on a local brain). Its reasoning stays hidden; you get the answer and how confident it is.

## Your calendar (read-only)
In **Connections → Calendar**, paste your calendar's private address in iCal format (the panel shows where to find it for Google, Outlook and
iCloud). Then ask "what's on my calendar today?", "what do I have tomorrow?" or "this week?". Your morning briefing and ULTRON's greetings
mention what's coming up. ULTRON can't change your calendar. Disconnect deletes the saved link. (Anyone with that private link can see your
calendar, so only paste it into ULTRON's settings, never into chats or emails.)

## ULTRON on your phone
1. Install **Tailscale** (free) on this PC and on your phone, and sign in to the same account on both.
2. On the PC, open a terminal and run `tailscale serve --bg 7477` (this gives your PC a private https address only your devices can reach).
3. In ULTRON: **Settings → Phone access**, enter the PC's Tailscale address (often filled in for you) and click **Turn phone access on**.
4. On the phone, open `https://<that address>`. Click **Pair a phone** on the PC and type the 6-digit code on the phone.
5. In the phone's browser menu choose **Add to Home Screen** for an ULTRON icon.

The phone can chat, talk, approve actions and use the stop button. API keys, folders, connections and paired devices can only be changed
on the PC. Remove a phone in Settings → Phone access and it's locked out at once. ULTRON has to be running on the PC.

## "Look at my screen"
Ask "Ultron, what's on my screen?" or "look at my screen, what's this error?" and ULTRON takes **one** screenshot of your main screen and
shows it to the brain to answer. It never looks unless you ask, the picture isn't saved, and the chat shows a 📸 chip each time. With a
local brain the picture never leaves your PC. Your brain must be able to see images: the recommended small local brain
(**gemma4:e2b**) can, as can Claude; for some other local models ULTRON tells you it can't and suggests one that can.

## Controlling your PC (Windows)
- **Music and volume:** "pause the music", "next song", "previous track", "turn it up", "turn it down a bit", "mute". These happen straight
  away (they're easy to undo) and are listed in Activity.
- **Apps:** "open Spotify", "launch Notepad". The card shows exactly which Start-menu app will open; click **Approve**. ULTRON can only open
  apps that are in your Start menu.
- **Your PC:** "how's my PC doing?", "am I running out of disk space?", "how much battery have I got?"

## Everyday help
Clear commands like these are answered instantly by ULTRON itself, without waiting for the AI brain: "open github.com",
"add milk and eggs to my list", "what's on my list?", "what's the weather?", "what's 15% of 80?". Anything chattier goes to the brain.

- **Conversions:** "convert 5 miles to km", "what's 72 F in C?", "how many cups in a litre?", "$50 in euros" (today's rates).
- **Words and world time:** "define serendipity", "what does ephemeral mean?", "what time is it in Tokyo?"
- **Maths:** "what's 15% of 80?", "split $86.40 four ways": ULTRON uses an exact calculator instead of guessing.
- **Facts:** "who was Ada Lovelace?" looks it up on Wikipedia and says so.
- **Weather:** "what's the weather?" (set your **Home city** in Settings → Personality) or "weather in Tokyo". It's also in your morning briefing.
- **Web search (optional):** Settings → Web search: get a free key at brave.com/search/api, paste it there (not in chat), then ask
  "search the web for…" or just ask about something recent. Searches go to Brave; nothing else leaves your PC.
- **Web pages:** paste a link and say "summarize this". Links you paste are read straight away; if ULTRON wants to open a page you *didn't* give it,
  it asks first. It never reads pages on your own computer or home network.
- **Past conversations:** "what did we talk about yesterday?", "did I mention the dentist?" ULTRON searches your earlier chats (stored only
  on this PC). Delete a conversation and it can't be recalled any more.
- **To-do list:** "add buy milk and call mum to my list", "what's on my list?", "I called mum" (ULTRON ticks it off, and asks if
  more than one item matches). You can also add, tick and delete items on the **Reminders** page. Open items are in your morning briefing.
- **Offers to remember:** mention something lasting ("my sister's birthday is March 3") and ULTRON may offer to remember it. Nothing is saved
  until you click **Approve**.

Settings → **Personality**: rename the assistant, choose how it addresses you ("sir", your name…), set humor, sarcasm, formality and answer length,
and change the hands-free wake word(s). **Reset to default** undoes everything. The safety rules (no claims of feelings, no pretend access,
documents and messages are information not orders) can't be changed.

## Memory: what ULTRON remembers
ULTRON only keeps long-term memories you explicitly give it:

- **Save:** start a message with "Remember…", e.g. *"Remember that I prefer instructions that say whether preheating is needed."*
- **Remove:** *"Forget that I prefer…"* removes the closest matching memory and tells you which one it removed.
- **Review:** **Memory Vault** lists everything, with where it came from and when. You can edit, pin (always considered), export or forget each one.

ULTRON finds memories by meaning, not just matching words: ask *"how hot should the oven be?"* and it can recall
*"I bake bread at 230 degrees"*. This uses a small model on your PC (about 23 MB, downloaded automatically the first time).

Ask **"what do you know about me?"** and ULTRON goes through everything it remembers (memories marked sensitive stay out unless you ask
for them).

When ULTRON uses a memory in a reply, it appears as a small `memory:xxxxxxxx` tag under the message.
Forgetting is permanent: the memory is deleted from the database and the search index (older backups you made yourself still contain it).

ULTRON refuses to store passwords, PINs, card or bank numbers, API keys and ID numbers, even if asked.
Health, money and similar details are stored only if you ask, and are marked **sensitive**.

## Local AI: a brain that runs on your PC
1. Install **Ollama** (free) from <https://ollama.com/download>. It runs quietly in the background.
2. ULTRON → **Settings → Language model → Local AI on this PC**. ULTRON shows your graphics card and RAM and recommends a model that fits.
3. Click **Download** (one time; 2–20 GB depending on the model), then **Use this brain**.

Everything then runs on your computer; you can unplug the internet. Bigger models are smarter but need a stronger graphics card.
You can download others by name from <https://ollama.com/library>.

**Switching brains:** say or type "switch your brain to local", "go offline", "switch to the test brain", or, if you've added an API key,
"switch to Claude" or "switch to Fable". The color changes so you always know: **cyan = local**, **amber = cloud** (your messages leave the PC), **violet = test**.

## Choosing a brain (Settings)
| Option | Needs | Notes |
|---|---|---|
| **Local AI (Ollama)** | Ollama installed + one model download | Recommended. Free, private, offline. |
| Built-in test brain | nothing | Canned replies. Everything else (history, memory) works. |
| Claude | Anthropic API key (console.anthropic.com) | Default model `claude-opus-5-5`; you can type another model ID. |
| OpenAI / local | OpenAI key, or a local server URL + model name | Works with Ollama and LM Studio (`http://localhost:11434/v1`). |

Keys are stored on this PC only and never displayed again. **Test connection** sends one tiny request to confirm the setup.

## Privacy at a glance
- ULTRON listens only on this computer (`localhost`). Other devices can't connect yet.
- Nothing is sent anywhere unless you choose a cloud model. Then your messages and relevant memories go to that provider.
- **Activity** shows every memory change, settings change and stop, with secrets redacted.

## Backups
Run `npm run backup` in the ULTRON folder. To restore, stop ULTRON and copy the backup file over `ultron.db` in the data folder.
API keys are not included in backups on purpose.
