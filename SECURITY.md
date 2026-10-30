# Security & privacy

## In place (v0.1, tested)
- **Local only.** The gateway binds to `127.0.0.1`. Requests must carry a loopback `Host` (blocks DNS rebinding) and, if present, a loopback `Origin` (blocks other websites).
- **Authenticated API.** Every route except `/api/health` and `/api/bootstrap` requires a random 256-bit bearer token (`<data>/local-token`, owner-only file mode).
- **Secrets encrypted at rest (Windows).** API keys and connector tokens are encrypted with Windows DPAPI for the current Windows user (data passed over stdin, never on a command line). Older plain files are upgraded automatically; a file that can't be decrypted (another user/PC) is set aside with a clear message, never crashes ULTRON. Backups never include secrets.
- **Secrets never leave the server.** API keys are write-only from the UI; settings responses only say whether a key exists. Keys and the token are scrubbed from logs (pattern + exact-value redaction) and from the audit log. Tests assert this.
- **Memory consent.** Only explicit "Remember…" or Vault entries are stored. Passwords, PINs, card/bank numbers, API keys and ID numbers are refused. Health/finance details are flagged sensitive.
- **Forget means delete.** Memory rows and their search-index entries are hard-deleted.
- **Honest capabilities.** The model is told the real capability state on every turn and instructed not to claim anything else.
- **Kill switch.** "Stop all" and client disconnects abort in-flight model requests (no further tokens spent).
- **Cost guards.** Max 16k output tokens per reply, history capped at 30 turns / 60k characters, one active reply per conversation.
- **Connected accounts.** Read-only by design (GitHub: fine-grained token with read permissions only, entered in the app, stored server-side, never shown). ULTRON only reports "connected" after a live read test. Only titles and links are stored (30-day expiry); other people's text is passed to the model as untrusted data. Disconnect deletes the token and all stored events. Token encryption at rest follows the same DPAPI plan as API keys.
- **Files.** ULTRON sees only folders the owner adds. Drives, the home root, system, credential and ULTRON's own folders are refused; hidden folders, symlinks and secret files are skipped; every read/open re-checks the real path; file content is passed to the model as untrusted data; opening on screen needs approval. The index stays local and is deleted when a folder is removed.
- **Actions are proposals.** Every tool call is validated against a schema, risk-classed (L0–L3) and policy-checked. External effects need a fresh click (never voice or model text); L3 is blocked; there's a kill switch; every action is recorded in `tool_executions` and the audit log. `open_website` launches the browser without a shell and only accepts plain http(s) URLs.
- **Local-first brain.** With Local AI selected, prompts, memories and replies never leave the computer. Cloud brains are opt-in; switching to one is announced in chat, colored amber, and audited. Brain switching is a deterministic owner command; model output can't trigger it.
- **Spoken replies.** Generated on the PC by default and never stored. The fallback uses only offline system voices.
- **Hands-free mode** is opt-in, visibly indicated, local-STT only, pauses while ULTRON speaks, and drops every phrase not addressed to ULTRON on the server (not returned, logged or stored). On/off is audited.
- **Microphone.** Opened only while push-to-talk is active, with a visible red Listening bar; all tracks stop immediately afterwards. Raw audio is processed in memory and never written to disk. The audit log records that the mic was used (engine, seconds, character count), never audio or words. Default engine is on-device Whisper; cloud transcription only if the owner selects it.
- **Audit trail** of memory changes, setting changes, blocked saves, stops and model errors.

## Independent review (2026-10-30)
A separate reviewer audited auth, actions, files, connectors and secrets overnight. All findings were fixed the same night, each with a regression test:
1. **High:** percent-encoded paths (`/%61pi/...`) skipped the token check. The check now uses the decoded path and the matched route.
2. Zip-bomb `.docx` could freeze/crash indexing. Inflation is capped at 5 MB, with bounds checks.
3. "Open on screen" could run programs, and a link could differ from what the approval card named; UNC paths reached the filesystem before checks.
   Programs/shortcuts now open their folder instead, link mismatches are refused, and network/device paths are rejected first.
4. Long tool results were cut mid-JSON. They're now capped structurally with a `truncated` flag.
5. "Forget" deleted fuzzy matches. It now needs a clear match, and voice can't delete memories or switch to a cloud brain.
6. Unlimited tool calls per reply: capped at 8.
7. A temporary DPAPI failure set keys aside. Now only genuine decryption errors do; temporary failures lock writes until restart.
8. Env-supplied secrets weren't exact-match scrubbed, and `github_pat_` wasn't pattern-matched. Both are fixed.

**Scope note:** the local session token protects against websites and other browsers. Like any single-user desktop app, it does not protect against
other programs already running as your Windows user (they could read the same data folder).

## Known gaps (tracked)
| Gap | Plan |
|---|---|
| macOS/Linux keep secrets protected by file permissions only (no keychain yet) | Keychain / libsecret support if ULTRON runs there |
| Approvals are click-only in the app; there is no secure way yet to approve from the phone | Phase 5 device pairing |
| Prompt-injection test suite only covers memory commands (model output can't save/delete memories) | Extend with tool/connector threat scenarios in Phase 3 |
| No per-provider spend budget / usage display | Phase 3–6 cost dashboard |
| Backups are unencrypted copies of `ultron.db` | Encrypted backup option in Phase 7 |
| Single owner, no multi-device auth | Phase 5 device pairing, short-lived tokens, revocation |

## Data locations
`%APPDATA%\ULTRON` (Windows) or `~/.ultron`: `ultron.db`, `secrets.json`, `local-token`, `backups/`.
Delete the folder to erase everything. If a cloud model is selected, each message plus relevant memories is sent to that provider.

## Reporting
This is a private project. Note issues in the tracker or tell the developer directly.
