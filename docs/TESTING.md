# Testing

```bash
npm test            # 37 unit + API integration tests, mock provider, no network or keys
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
| E2E (browser) | home online, remember in chat, recall in new conversation with citation tag, survives reload, vault delete, activity entry, accessibility toggles, phone width, offline banner after service stops |

## Results, 2026-10-30 (Linux cloud container, Node 22.22, Chromium via Playwright)
- `npm test`: **37/37 passed** (~2.5 s)
- `npm run test:e2e`: **9/9 steps passed**
- `npm run lint`: clean · `npm run build`: OK · `npm run doctor`: all checks pass

## Not yet verified
- Running on an actual Windows PC (CI covers Windows for unit tests once the repo is pushed to GitHub; the launcher `.bat`/`.ps1` needs a manual run).
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
