# OpenClaw spike for ULTRON

**Method.** This was a read-only desk evaluation done on 2026-10-30. I made a shallow clone (`git clone --depth 1`) of openclaw/openclaw at commit `22a0cafd`, dated 2026-10-29, and read its docs and manifests. I did not install, build or run anything, so there is **no running proof of concept**. The GitHub REST API was blocked for this session. Release data comes from `git ls-remote --tags` and shallow tag fetches. Leon was checked through its raw README and LICENSE. Paths below are relative to `spike/openclaw/`.

## Facts observed

| Item | Finding | Source |
|---|---|---|
| License | MIT, "Copyright (c) 2026 OpenClaw Foundation" | `LICENSE`, `package.json` (`"license":"MIT"`) |
| Governance | OpenClaw Foundation, a 501(c)(3). No paid tier. OpenAI is listed as a donor. | `README.md` (Governance) |
| Language/runtime | TypeScript on Node, as a pnpm monorepo. Native apps are in Swift (macOS/iOS, about 472k lines), Kotlin (Android, about 258k) and Rust crates (about 56k). | `pnpm-workspace.yaml`, `apps/`, `crates/` |
| Node required | `engines.node: ">=24.16.0 <25 \|\| >=26.1.0"`. The README says 24.22.1+ or 26.12.1+, with 26 recommended. The two disagree slightly. | `package.json`, `README.md` |
| Size | 61,197 files. About 10.8M lines of `.ts` in total, of which about 5.7M are `*.test.ts`. About 3.0M non-test `.ts` lines sit under `src/` alone. There are also about 362k lines of `.tsx` and about 330k of `.js`/`.mjs`. | `find`/`wc` |
| Dependencies | The root `package.json` has 77 runtime deps, 57 dev deps and 1 optional. There are 213 `package.json` files across the workspace, 189 dirs under `extensions/`, 25 under `packages/` and 51 under `skills/`. Notable root deps: `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@modelcontextprotocol/*`, `playwright-core`, `pg`, `kysely`, `express`, `ws`, `grammy`, `@lydell/node-pty`, `npm`. | `package.json` |
| Storage | SQLite state at `~/.openclaw/state/openclaw.sqlite`, through a `node:sqlite` wrapper. Postgres is optional. | `node-sqlite.mjs`, `docs/nodes/voicewake.md`, `docs/gateway/postgresql.md` |
| Release cadence | 549 tags. Calendar-versioned stable releases ship several times a week: v2026.10.4 (10-15), .6 (10-22), .8 (10-26), .9 (10-29), with v2026.10.10-beta.5 also on 10-29. Stable tags per month: Jun 44, Jul 6, Aug 5, Sep 13. | `git ls-remote --tags`, shallow tag fetch |
| Windows | The installer supports Windows through PowerShell. The recommended desktop app is "Windows Hub", a native WinUI app kept in a **separate repo** (`openclaw/openclaw-windows-node`). By default its local setup provisions an **app-owned WSL distro** that runs the Gateway. A Tauri app is the backup. The project's own maturity scorecard rates Windows via WSL2 as M3 Beta, Windows App/Node as M3 Beta (quality 19%, completeness 21%) and Native Windows as **M2 Alpha**. | `docs/platforms/windows.md`, `docs/maturity/scorecard.md` |
| Architecture | One long-lived **Gateway** daemon listens on WS `127.0.0.1:18789` and uses a JSON-Schema-validated typed protocol. **Clients** (CLI, Control UI, TUI, apps) and **Nodes** (devices that connect with `role: node` and declare capabilities such as `camera.*`, `screen.record`, `system.run`) use the same WS server, and nodes pair per device. **Channels** cover WhatsApp, Telegram, Slack, Discord, Signal, iMessage and 20+ more. | `docs/concepts/architecture.md`, `docs/gateway/protocol*` |
| Plugins | Native plugins load **in-process** (Node/jiti) and register capabilities through `api.registerProvider`, `registerSpeechProvider`, `registerRealtimeVoiceProvider`, `registerRealtimeTranscriptionProvider`, `registerWebSearchProvider` and so on. There is a plugin SDK package and a ClawHub registry. | `docs/plugins/architecture.md` (line ~117), `packages/plugin-sdk` |
| Skills | `SKILL.md` with YAML frontmatter and an `openclaw` metadata block (`requires.bins`, install recipes). This is broadly the same shape as Anthropic/Leon agent skills. | `skills/*/SKILL.md` |
| Permissions | There are three separate layers. **Sandbox** decides where tools run (`off` / `non-main` / `all`). **Tool policy** sets allow/deny lists. **Elevated** is the exec escape hatch. On top of these, per-session **permission modes** are `read-only`, `guarded` (human approves exec after an allowlist fast path), `workspace` (an LLM reviewer allows, denies or escalates to a human) and `full`. Approvals bind executables by real path and content hash. Chat approvals need `/approve <id>`, and free-text "yes" is ignored. **The default with no configuration is full host access**: "Tools run on the host for the main session unless you configure sandboxing." | `docs/gateway/permission-modes.md`, `docs/gateway/sandbox-vs-tool-policy-vs-elevated.md`, `README.md` (Security) |
| Identity/persona | Workspace markdown files: `SOUL.md` (voice/tone), `IDENTITY.md` (name, vibe, emoji), `AGENTS.md` (operating rules), `USER.md` (user model, 4k cap), `MEMORY.md`. These are injected every session within char budgets. | `docs/concepts/soul.md`, `docs/concepts/agent-workspace.md` |
| Web/mobile | The Control UI is a Vite web app. It ships `manifest.webmanifest`, `sw.js` and Web Push (`ui/src/app/web-push.ts`), so it is **PWA-capable**. There are native iOS and Android apps in `apps/`. | `ui/public/`, `apps/ios`, `apps/android` |
| Voice | Gateway-owned wake words stored in SQLite. Talk mode, plus realtime voice and STT through provider plugins (OpenAI, Google), and ElevenLabs/Microsoft TTS. Voice wake is documented for macOS 26+, iOS and Android. **Windows is not listed for voice wake.** The Hub mentions "talk". | `docs/nodes/voicewake.md`, `docs/nodes/talk.md`, `docs/platforms/windows.md` |
| Branding | The default persona and lore are "Molty", a space lobster, and the PWA name is "OpenClaw Control". I found no trademark clause in the repo. Policy on the OpenClaw name/marks is **unverified**. | `README.md`, `ui/public/manifest.webmanifest` |

**Leon (leon-ai/leon).** MIT licensed, copyright 2019-present Louis Grenard. A README notice dated 2026-03-29 says the project is focused on a **2.0 Developer Preview** on `develop`, its docs are "not ready yet", and the legacy stable version lives on `master`. It needs Node >= 24 and lists Linux, macOS and Windows as supported. It has native skills plus `SKILL.md` agent skills, and the modes `smart`, `controlled` and `agent`. Its pre-release state makes it a weaker base than OpenClaw. I could not get star counts or activity metrics because the API was blocked.

## Fit against criteria

| Criterion | Extend OpenClaw (A) | Custom core (B) |
|---|---|---|
| Maintenance | It is very active, with several releases a week. For a fork, that pace is a cost: around 3M non-test LOC in `src/` and 77 root deps means constant rebase churn. Staying upstream and adding plugins avoids the churn but gives up control. | You own everything, and the surface stays small. |
| Windows support | Weak for a Windows-first product. The project rates native Windows as Alpha. The recommended path runs the Gateway in WSL, and the Hub lives in another repo. Voice wake is not documented on Windows. | You can target native Windows Node directly. |
| Security boundary control | The design is rich and mature (modes, reviewers, exec binding). But the default is full host access, and plugins load in-process with full trust. Auditing a policy engine this large is hard. | A small boundary you can reason about, and default-deny is possible. You would build it yourself, ideally copying OpenClaw's model. |
| Mobile support | Strong: a PWA Control UI with push, plus native iOS and Android apps. | You would build the PWA yourself, which was already the plan. |
| Plugin compatibility | You get the ClawHub ecosystem, 189 extensions and MCP. | If you mirror the `SKILL.md` format and use MCP, you keep partial compatibility with skills, but not with native OpenClaw plugins. |
| Owner experience | Large feature surface, many config keys and a doctor CLI. Steep to own and debug as one person. | Simpler, and it fits a single-owner project. |
| Identity customization | Easy at the persona level: edit `SOUL.md` and `IDENTITY.md`. A full rebrand (UI, apps, CLI name, lore) is a large fork. | You have full control. |

## Patterns worth borrowing

1. **Gateway plus node roles over one WS protocol.** Desktop, PWA and phone each connect as clients or nodes that declare their capabilities. JSON-Schema-validated frames carry events such as `agent`, `chat`, `presence` and `health`, and connect returns a hello/snapshot.
2. **Workspace persona files** (`SOUL.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, `MEMORY.md`) with per-file char budgets and a marker when a file is missing. These map directly onto ULTRON's identity.
3. **Session permission modes** (`read-only` / `guarded` / `workspace` / `full`) as one user-facing knob, built on separate sandbox, tool-policy and elevated layers. ULTRON should default to `guarded`, not full.
4. **Exec approval hardening.** Bind each resolved executable by real path, and by content hash when it is writable, then re-check before launch. Approvals need an explicit `/approve <id> allow-once|deny`, and free-text "yes" never counts. Stopping a run cancels its pending approval.
5. **Capability-typed provider registry** (`registerProvider`, `registerSpeechProvider`, `registerRealtimeTranscriptionProvider`, `registerRealtimeVoiceProvider`). This fits ULTRON's provider-agnostic LLM and voice interface.
6. **Device pairing** for new nodes and DM senders, with an approval code.
7. **Gateway-owned wake-word list** stored in SQLite and broadcast to every client.
8. **PWA shell**: `manifest.webmanifest`, `sw.js` and Web Push in the Control UI.
9. **`SKILL.md` frontmatter** with `requires.bins` and install recipes, so ULTRON skills stay compatible with the format.
10. **`sandbox explain`-style inspector** that shows the effective policy and where each setting came from.

## Risks

- **Option A:** high upstream velocity makes a fork expensive to maintain. Windows-native is Alpha, and the WSL dependency undercuts a native Windows voice assistant. Plugins run in-process with full trust, and the default is full host access. The dependency and supply-chain surface is very large (77 root deps plus 189 extensions, including `npm` and `playwright-core`). The trademark and rebrand policy is unverified. Heavy "Molty" branding runs through docs, UI and apps.
- **Option B:** you must build approvals, pairing and voice plumbing yourself, and the security engine is easy to get subtly wrong. It is tempting to under-invest in sandboxing. There is no ecosystem on day one.
- **Unverified (not run):** actual Windows install behaviour, voice latency, memory and CPU footprint, how hard a rebrand is in practice, the security advisory history, and GitHub activity metrics (API blocked).

## Recommendation

**B: a custom lightweight TypeScript core that deliberately borrows OpenClaw's patterns.** Take the protocol shape, the persona files, the permission modes and exec binding, the capability registry, pairing, and the `SKILL.md` format.

OpenClaw is MIT licensed, so you can study and adapt specific modules with attribution. Its own docs rate native Windows as Alpha and route Windows through WSL, which conflicts with ULTRON's main requirement of a native Windows voice assistant. Its size and release pace make a fork or rebrand a long-term maintenance burden for one owner. Two things are worth revisiting:

- OpenClaw's Gateway as an optional backend you can swap in, if mobile or channel reach later matters more than Windows-native.
- Running stock OpenClaw beside ULTRON, connected through MCP or its OpenAI-compatible HTTP API (`docs/gateway/openai-http-api.md`), instead of forking it.
