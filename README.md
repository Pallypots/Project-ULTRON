# ULTRON

A private, persistent personal AI assistant that runs on your own Windows PC. ULTRON keeps your conversations,
remembers what you explicitly ask it to, and tells you honestly what it can and can't do.

> ULTRON is software, not a sentient being. It has a personality, not feelings.

![Home HUD](docs/screenshots/01-home.png)

## What works today (v0.1, dev cycle 1)

| Feature | Status |
|---|---|
| Chat with streaming replies | ✅ working |
| Conversations saved and restored after restart | ✅ working |
| "Remember that…" / "Forget…" in chat, with a Memory Vault to view, edit, pin, export, delete | ✅ working |
| Memories recalled in *new* conversations, cited as `[memory:xxxxxxxx]` | ✅ working |
| Refuses to store passwords, card numbers, API keys, ID numbers | ✅ working |
| Choose the brain: built-in mock (no account), Claude, OpenAI, or a local model (Ollama/LM Studio) | ✅ built; mock is tested, real providers **not yet tested with a live key** |
| Original cyan HUD interface, high-contrast and reduced-motion modes, phone-width layout | ✅ working |
| Online/offline indicator, emergency **Stop all**, activity/audit log, redacted log export | ✅ working |
| Voice (push-to-talk, spoken replies) | ⏳ next cycle |
| Reminders and other actions, connected accounts, phone access | ⏳ planned (see [ROADMAP](docs/ROADMAP.md)) |

## Start it on Windows (no coding needed)

1. Install **Node.js LTS** (version 22 or newer) from <https://nodejs.org>. Accept the defaults.
2. Get the ULTRON folder onto your PC (download the ZIP from GitHub and unzip it, or `git clone`).
3. Double-click **`Start-ULTRON.bat`**.
   The first run installs components and builds the interface, which takes 1–2 minutes. ULTRON then opens in its own window.
   Keep the small black launcher window open; closing it stops ULTRON.
4. ULTRON starts on the free built-in **mock model** so you can try everything immediately.
   To give it a real brain, open **Settings**, choose Claude or OpenAI/local, paste your API key, click **Save**, then **Test connection**.

> A Claude.ai or ChatGPT subscription does **not** include API access. API usage is billed separately by Anthropic/OpenAI.
> For free, private, offline use you can install [Ollama](https://ollama.com), then choose "OpenAI or local model" with
> server URL `http://localhost:11434/v1` and your model's name.

Something wrong? In the ULTRON folder, open PowerShell and run `npm run doctor`. It checks everything and explains fixes in plain English.

## Commands (for developers)

```bash
npm install          # once
npm start            # build UI + run ULTRON at http://localhost:7477
npm run dev          # hot-reload UI at http://localhost:5173 + auto-restarting gateway
npm test             # unit + API integration tests (no API key needed)
npm run test:e2e     # real-browser end-to-end test (needs Playwright + Chromium) + screenshots
npm run lint         # TypeScript type check
npm run doctor       # environment diagnosis
npm run backup       # consistent database snapshot into <data folder>/backups
```

Your data lives in `%APPDATA%\ULTRON` on Windows (`~/.ultron` elsewhere): `ultron.db` (conversations, memories, activity),
`secrets.json` (API keys), `local-token` (session key for the UI).

## Documentation

[User guide](docs/USER_GUIDE.md) · [Architecture](docs/ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md) · [Roadmap](docs/ROADMAP.md) ·
[Security](SECURITY.md) · [Testing](docs/TESTING.md) · [Changelog](CHANGELOG.md) · [OpenClaw evaluation](docs/OPENCLAW_SPIKE.md)
