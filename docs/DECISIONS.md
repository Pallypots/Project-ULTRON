# Decision log

Each entry: date, decision, why, and how to revisit it.

### D-001 · 2026-10-30 · Custom lightweight core, borrowing OpenClaw patterns (option B)
A bounded **read-only** evaluation of OpenClaw (MIT, ~3M non-test LOC in `src/`, 77 root deps, several releases a week)
found that native Windows is rated **Alpha** by the project itself, the recommended Windows path runs the gateway in **WSL**, voice wake isn't documented
on Windows, plugins load in-process with full trust, and the default is full host access. Forking would mean constant rebase churn for a single owner.
We build a small TypeScript core and deliberately borrow: persona files, permission modes + exec binding, capability-typed provider registry,
device pairing, gateway/node protocol shape, PWA shell, `SKILL.md` format. **Caveat:** the blueprint asked for a one-day running PoC of both options;
this cycle did a desk evaluation only (nothing from OpenClaw was installed or run). See [OPENCLAW_SPIKE.md](OPENCLAW_SPIKE.md).
Revisit if mobile/channel reach becomes more important than Windows-native, or run stock OpenClaw beside ULTRON via MCP.

### D-002 · SQLite via Node's built-in `node:sqlite` (not Postgres + pgvector yet)
Zero install and no native compilation on Windows, plus FTS5 full-text search is built in. Postgres + pgvector can come when multi-device sync or embeddings need it;
the store classes are the only code that touches SQL. `node:sqlite` prints an "experimental" warning, which we suppress. It is stable enough for our use, and doctor checks it.

### D-003 · Keyword (BM25) memory retrieval first, embeddings later
Works offline with no embedding provider or key, is deterministic and testable, and explains itself. The retrieval call site is a single method, ready for hybrid search.

### D-004 · Explicit memory commands handled by code, not the model
"Remember…/Forget…" are parsed deterministically so saving and deleting are reliable, auditable and can't be triggered by injected text in model output.
Trade-off: no automatic memory extraction yet, which is intentional per the consent rules.

### D-005 · Hard delete for "forget"
Row and search index are removed immediately. Owner-made backups are the only remaining copies (documented in the user guide and SECURITY.md).

### D-006 · Desktop window = Edge app mode now, Tauri later
Tauri needs Rust + MSVC build tools on the owner's PC and couldn't be compiled in this cloud dev environment (no WebKit libs).
Microsoft Edge ships with Windows and `--app=` gives a chromeless window with zero extra installs. A Tauri shell is scaffolded in `apps/desktop/src-tauri` (unverified).

### D-007 · Default models
Anthropic: `claude-opus-5-5` (current default model per Anthropic's docs as of 2026-10-30), effort `low` for conversational latency/cost,
server-side refusal fallbacks enabled (`fallbacks: "default"`). OpenAI/local: **no default**; the owner picks a model because availability varies.
All are changeable in Settings without code.

### D-008 · Loopback-only gateway with Host/Origin checks + bearer token
Every request must target `localhost` (blocks DNS-rebinding) from a loopback Origin (blocks other websites). All non-public routes need a random 256-bit token
stored in the data folder. Remote access waits for Phase 5 (Tailscale + device pairing), never an open port.

### D-009 · npm workspaces, TypeScript run directly with `tsx`
No compile step for the server, so fewer moving parts for a non-technical owner. Pinned TypeScript 5.9 (7.x is the brand-new native compiler; not worth the risk yet).

### D-010 · SSE (not WebSocket) for streaming replies
Simpler, works through proxies, trivially testable. WebSocket/WebRTC will be introduced for voice (Phase 2) and multi-device push (Phase 5).
