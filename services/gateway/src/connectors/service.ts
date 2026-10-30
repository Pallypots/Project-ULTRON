import type { IntegrationRow, Stores } from "@ultron/memory";
import type { SecretStore } from "../secrets.ts";
import type { EventBus } from "../actions/events.ts";
import { GITHUB_CAPABILITIES, GithubConnector, type GithubRepo } from "./github.ts";
import { ConnectorError } from "./types.ts";

const SECRET = "ULTRON_GITHUB_TOKEN";
const SYNC_EVERY_MS = 15 * 60_000;
const MAX_REPOS = 25;

export interface ConnectorInfo {
  id: string;
  label: string;
  available: boolean;
  connected: boolean;
  account: string | null;
  capabilities: string[];
  health: IntegrationRow["health"];
  healthDetail: string;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  repos?: string[];
  note: string;
}

/** Owns connected accounts: connecting (with a real read test), syncing on a schedule, and disconnecting (deletes everything). */
export class ConnectorService {
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;

  constructor(
    private stores: Stores,
    private secrets: SecretStore,
    private bus: EventBus,
  ) {}

  private github(): GithubConnector | null {
    const t = this.secrets.get(SECRET);
    return t ? new GithubConnector(t) : null;
  }

  start() {
    this.timer = setInterval(() => this.syncIfDue().catch(() => {}), 60_000);
    this.timer.unref?.();
    this.syncIfDue().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  info(): ConnectorInfo[] {
    const g = this.stores.connectors.integration("github");
    const connected = Boolean(g?.connectedAt && this.secrets.has(SECRET));
    return [
      {
        id: "github",
        label: "GitHub",
        available: true,
        connected,
        account: g?.account ?? null,
        capabilities: GITHUB_CAPABILITIES,
        health: connected ? (g?.health ?? "ok") : "not_connected",
        healthDetail: g?.healthDetail ?? "",
        lastSyncAt: g?.lastSyncAt ?? null,
        nextSyncAt: g?.nextSyncAt ?? null,
        repos: ((g?.config.repos as string[]) ?? []).slice(),
        note: "Read-only: commits, pull requests, issues, failed workflow runs and releases for repos you choose. Titles and links only.",
      },
      { id: "youtube", label: "YouTube", available: false, connected: false, account: null, capabilities: [], health: "not_connected", healthDetail: "", lastSyncAt: null, nextSyncAt: null, note: "Next: needs a Google Cloud OAuth app (YouTube Data API, read-only scope) that you create once." },
      { id: "reddit", label: "Reddit", available: false, connected: false, account: null, capabilities: [], health: "not_connected", healthDetail: "", lastSyncAt: null, nextSyncAt: null, note: "Reddit requires explicit API approval for your account first. Until then ULTRON can only work with links you paste." },
      { id: "discord", label: "Discord", available: false, connected: false, account: null, capabilities: [], health: "not_connected", healthDetail: "", lastSyncAt: null, nextSyncAt: null, note: "Will use an official Discord bot you invite to your own server, never your personal account (self-bots break Discord's rules)." },
    ];
  }

  async connectGithub(token: string): Promise<ConnectorInfo> {
    const gh = new GithubConnector(token.trim());
    const account = await gh.whoAmI(); // throws a clear error if the token doesn't work
    this.secrets.set(SECRET, token.trim());
    const prev = this.stores.connectors.integration("github");
    this.stores.connectors.saveIntegration("github", { account, health: "ok", healthDetail: "Connected. Choose repos to watch.", connectedAt: new Date().toISOString(), config: prev?.config ?? { repos: [] } });
    this.stores.audit.record("connector.connected", "owner", "github", { account });
    return this.info()[0]!;
  }

  async listGithubRepos(): Promise<GithubRepo[]> {
    const gh = this.github();
    if (!gh) throw new ConnectorError("GitHub isn't connected.", "auth");
    return gh.listRepos();
  }

  async setGithubRepos(repos: string[]): Promise<ConnectorInfo> {
    const gh = this.github();
    if (!gh) throw new ConnectorError("GitHub isn't connected.", "auth");
    if (repos.length > MAX_REPOS) throw new ConnectorError(`Pick at most ${MAX_REPOS} repos.`, "bad_request");
    const checked: string[] = [];
    const privacy: Record<string, boolean> = {};
    for (const r of [...new Set(repos)]) {
      const info = await gh.checkRepo(r);
      checked.push(info.fullName);
      privacy[info.fullName] = info.private;
    }
    const g = this.stores.connectors.integration("github")!;
    this.stores.connectors.saveIntegration("github", { config: { ...g.config, repos: checked, private: privacy }, nextSyncAt: new Date().toISOString() });
    this.stores.audit.record("connector.repos_changed", "owner", "github", { count: checked.length });
    return this.info()[0]!;
  }

  async syncIfDue() {
    const g = this.stores.connectors.integration("github");
    if (!g?.connectedAt || !(g.config.repos as string[] | undefined)?.length) return;
    if (g.nextSyncAt && new Date(g.nextSyncAt) > new Date()) return;
    await this.syncGithub();
  }

  async syncGithub(): Promise<{ added: number; info: ConnectorInfo }> {
    const gh = this.github();
    const g = this.stores.connectors.integration("github");
    if (!gh || !g?.connectedAt) throw new ConnectorError("GitHub isn't connected.", "auth");
    const repos = (g.config.repos as string[]) ?? [];
    if (!repos.length) throw new ConnectorError("Choose at least one repo to watch first.", "bad_request");
    if (this.syncing) return { added: 0, info: this.info()[0]! };
    this.syncing = true;
    this.stores.connectors.saveIntegration("github", { health: "syncing", healthDetail: "Syncing…" });
    try {
      const res = await gh.sync(repos, g.cursor as Record<string, string>);
      const added = this.stores.connectors.addEvents(res.events);
      this.stores.connectors.purgeExpired();
      const now = new Date();
      this.stores.connectors.saveIntegration("github", {
        cursor: res.cursor,
        health: "ok",
        healthDetail: `Last sync found ${added} new update${added === 1 ? "" : "s"}.`,
        lastSyncAt: now.toISOString(),
        nextSyncAt: new Date(now.getTime() + SYNC_EVERY_MS).toISOString(),
      });
      this.stores.audit.record("connector.synced", "system", "github", { added, repos: repos.length });
      this.bus.emit({ type: "connector_synced", source: "github", added });
      return { added, info: this.info()[0]! };
    } catch (err) {
      const e = err instanceof ConnectorError ? err : new ConnectorError((err as Error).message, "unavailable");
      this.stores.connectors.saveIntegration("github", {
        health: e.code === "rate_limited" ? "rate_limited" : "error",
        healthDetail: e.message,
        // Back off: retry after the rate-limit reset, or in 15 minutes.
        nextSyncAt: e.retryAt ?? new Date(Date.now() + SYNC_EVERY_MS).toISOString(),
      });
      this.stores.audit.record("connector.sync_failed", "system", "github", { code: e.code });
      throw e;
    } finally {
      this.syncing = false;
    }
  }

  /** Watched repos and whether each is private; actions may only target these. */
  watchedRepos(): { name: string; private: boolean | null }[] {
    const g = this.stores.connectors.integration("github");
    if (!g?.connectedAt) return [];
    const priv = (g.config.private as Record<string, boolean>) ?? {};
    return ((g.config.repos as string[]) ?? []).map((name) => ({ name, private: name in priv ? priv[name]! : null }));
  }

  async createGithubIssue(repo: string, title: string, body: string) {
    const gh = this.github();
    if (!gh) throw new ConnectorError("GitHub isn't connected.", "auth");
    if (!this.watchedRepos().some((r) => r.name.toLowerCase() === repo.toLowerCase()))
      throw new ConnectorError(`ULTRON can only post to repos you watch. ${repo} isn't one of them (Connections → GitHub → Choose repos).`, "bad_request");
    const res = await gh.createIssue(repo, title, body);
    this.stores.audit.record("connector.github_issue_created", "owner", "github", { repo, number: res.number });
    return res;
  }

  /** Disconnect deletes the token and every stored GitHub event. */
  disconnectGithub(): number {
    this.secrets.set(SECRET, null);
    const removed = this.stores.connectors.removeIntegration("github");
    this.stores.audit.record("connector.disconnected", "owner", "github", { eventsDeleted: removed });
    return removed;
  }
}
