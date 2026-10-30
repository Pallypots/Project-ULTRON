# ULTRON user guide

## Talking to ULTRON
Open **Chat**, type, press **Enter**. **Shift+Enter** adds a new line. **Esc** or **Stop** cancels a reply mid-sentence.
**Stop all** (bottom-left, every screen) cancels everything ULTRON is doing.

## Memory: what ULTRON remembers
ULTRON only keeps long-term memories you explicitly give it:

- **Save:** start a message with "Remember…", e.g. *"Remember that I prefer instructions that say whether preheating is needed."*
- **Remove:** *"Forget that I prefer…"* removes the closest matching memory and tells you which one it removed.
- **Review:** **Memory Vault** lists everything, with where it came from and when. You can edit, pin (always considered), export or forget each one.

When ULTRON uses a memory in a reply, it appears as a small `memory:xxxxxxxx` tag under the message.
Forgetting is permanent: the memory is deleted from the database and the search index (older backups you made yourself still contain it).

ULTRON refuses to store passwords, PINs, card or bank numbers, API keys and ID numbers, even if asked.
Health, money and similar details are stored only if you ask, and are marked **sensitive**.

## Choosing a brain (Settings)
| Option | Needs | Notes |
|---|---|---|
| Built-in mock | nothing | Canned replies. Everything else (history, memory) works. |
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
