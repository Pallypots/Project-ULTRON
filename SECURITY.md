# Security & privacy

## In place (v0.1, tested)
- **Local only.** The gateway binds to `127.0.0.1`. Requests must carry a loopback `Host` (blocks DNS rebinding) and, if present, a loopback `Origin` (blocks other websites).
- **Authenticated API.** Every route except `/api/health` and `/api/bootstrap` requires a random 256-bit bearer token (`<data>/local-token`, owner-only file mode).
- **Secrets never leave the server.** API keys are write-only from the UI; settings responses only say whether a key exists. Keys and the token are scrubbed from logs (pattern + exact-value redaction) and from the audit log. Tests assert this.
- **Memory consent.** Only explicit "Remember…" or Vault entries are stored. Passwords, PINs, card/bank numbers, API keys and ID numbers are refused. Health/finance details are flagged sensitive.
- **Forget means delete.** Memory rows and their search-index entries are hard-deleted.
- **Honest capabilities.** The model is told the real capability state on every turn and instructed not to claim anything else.
- **Kill switch.** "Stop all" and client disconnects abort in-flight model requests (no further tokens spent).
- **Cost guards.** Max 16k output tokens per reply, history capped at 30 turns / 60k characters, one active reply per conversation.
- **Audit trail** of memory changes, setting changes, blocked saves, stops and model errors.

## Known gaps (tracked)
| Gap | Plan |
|---|---|
| API keys stored as a JSON file (owner-only permissions), **not yet encrypted** with Windows DPAPI/keychain | UL-005b: DPAPI on Windows |
| No tools/actions exist yet, so no policy engine yet | UL-010 adds risk levels L0–L3 and approvals before any action ships |
| Prompt-injection test suite only covers memory commands (model output can't save/delete memories) | Extend with tool/connector threat scenarios in Phase 3 |
| No per-provider spend budget / usage display | Phase 3–6 cost dashboard |
| Backups are unencrypted copies of `ultron.db` | Encrypted backup option in Phase 7 |
| Single owner, no multi-device auth | Phase 5 device pairing, short-lived tokens, revocation |

## Data locations
`%APPDATA%\ULTRON` (Windows) or `~/.ultron`: `ultron.db`, `secrets.json`, `local-token`, `backups/`.
Delete the folder to erase everything. If a cloud model is selected, each message plus relevant memories is sent to that provider.

## Reporting
This is a private project. Note issues in the tracker or tell the developer directly.
