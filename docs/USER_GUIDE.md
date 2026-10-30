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
- Voices run **on your PC** (Kokoro; ~90 MB one-time download). Default is "George" (British). "Heart" (American) is the highest-rated.
  Change voice and speed in Settings → Spoken replies, and use **Preview voice** to hear it. Windows' built-in voices are a no-download fallback.

## Memory: what ULTRON remembers
ULTRON only keeps long-term memories you explicitly give it:

- **Save:** start a message with "Remember…", e.g. *"Remember that I prefer instructions that say whether preheating is needed."*
- **Remove:** *"Forget that I prefer…"* removes the closest matching memory and tells you which one it removed.
- **Review:** **Memory Vault** lists everything, with where it came from and when. You can edit, pin (always considered), export or forget each one.

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
