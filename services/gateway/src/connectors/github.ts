import type { NewConnectorEvent } from "@ultron/memory";
import { ConnectorError, type CapabilityFlag, type SyncResult } from "./types.ts";

export const GITHUB_CAPABILITIES: CapabilityFlag[] = ["READ_FEED", "READ_DETAILS"];
const RETENTION_DAYS = 30;
const FIRST_SYNC_DAYS = 7;

export interface GithubRepo {
  fullName: string;
  private: boolean;
  pushedAt: string | null;
  description: string | null;
}

const firstLine = (s: string | null | undefined) => (s ?? "").split("\n")[0]!.trim();

/**
 * Read-only GitHub connector over the official REST API. Stores titles, states and links only (no code or issue bodies),
 * so little private content is kept, and less untrusted text is handed to the model.
 */
export class GithubConnector {
  constructor(
    private token: string,
    private apiUrl = process.env.ULTRON_GITHUB_API ?? "https://api.github.com",
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiUrl}${path}`, {
        headers: { authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "ULTRON-assistant" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ConnectorError("Couldn't reach GitHub. Check your internet connection.", "unavailable");
    }
    if (res.status === 401) throw new ConnectorError("GitHub rejected the token (expired or revoked). Reconnect with a new token.", "auth");
    if ((res.status === 403 || res.status === 429) && (res.headers.get("x-ratelimit-remaining") === "0" || res.status === 429)) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0);
      const retryAt = reset ? new Date(reset * 1000).toISOString() : new Date(Date.now() + 15 * 60_000).toISOString();
      throw new ConnectorError(`GitHub rate limit reached. ULTRON will try again after ${new Date(retryAt).toLocaleTimeString()}.`, "rate_limited", retryAt);
    }
    if (res.status === 403) throw new ConnectorError("The token doesn't have permission for that. Check its repository access and read permissions.", "auth");
    if (res.status === 404) throw new ConnectorError("Not found, or the token can't see it.", "not_found");
    if (!res.ok) throw new ConnectorError(`GitHub returned an error (${res.status}).`, "unavailable");
    return (await res.json()) as T;
  }

  /** Read test used when connecting: proves the token works before ULTRON says "connected". */
  async whoAmI(): Promise<string> {
    try {
      return (await this.get<{ login: string }>("/user")).login;
    } catch (err) {
      // Some tokens (e.g. app installation tokens) can read repos but not /user.
      if (err instanceof ConnectorError && err.code === "auth" && !/rejected/.test(err.message)) return "token";
      throw err;
    }
  }

  async listRepos(): Promise<GithubRepo[]> {
    const rows = await this.get<{ full_name: string; private: boolean; pushed_at: string | null; description: string | null }[]>("/user/repos?per_page=100&sort=pushed");
    return rows.map((r) => ({ fullName: r.full_name, private: r.private, pushedAt: r.pushed_at, description: r.description }));
  }

  async checkRepo(fullName: string): Promise<GithubRepo> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new ConnectorError(`"${fullName}" isn't a repository name like owner/repo.`, "bad_request");
    const r = await this.get<{ full_name: string; private: boolean; pushed_at: string | null; description: string | null }>(`/repos/${fullName}`);
    return { fullName: r.full_name, private: r.private, pushedAt: r.pushed_at, description: r.description };
  }

  /** Posts an issue. Only ever called after the owner approved the exact preview. Needs Issues: write on the token. */
  async createIssue(repo: string, title: string, body: string): Promise<{ number: number; url: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiUrl}/repos/${repo}/issues`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "ULTRON-assistant", "content-type": "application/json" },
        body: JSON.stringify({ title, body }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ConnectorError("Couldn't reach GitHub. Check your internet connection.", "unavailable");
    }
    if (res.status === 401) throw new ConnectorError("GitHub rejected the token. Reconnect GitHub.", "auth");
    if (res.status === 403 || res.status === 404)
      throw new ConnectorError(`The GitHub token isn't allowed to create issues in ${repo}. Edit the token on GitHub and set "Issues" to "Read and write" for that repo, then try again.`, "auth");
    if (res.status === 410) throw new ConnectorError(`Issues are turned off for ${repo}.`, "not_supported");
    if (!res.ok) throw new ConnectorError(`GitHub returned an error (${res.status}).`, "unavailable");
    const j = (await res.json()) as { number: number; html_url: string };
    return { number: j.number, url: j.html_url };
  }

  /** Incremental sync: everything since each repo's cursor (first sync looks back 7 days). */
  async sync(repos: string[], cursor: Record<string, string>, now = new Date()): Promise<SyncResult> {
    const events: NewConnectorEvent[] = [];
    const next: Record<string, string> = { ...cursor };
    const expiry = new Date(now.getTime() + RETENTION_DAYS * 86_400_000).toISOString();
    for (const repo of repos) {
      const since = cursor[repo] ?? new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000).toISOString();
      const short = repo.split("/")[1]!;
      const base = { source: "github", accountId: null, projectTags: [short], contentExpiry: expiry };

      const commits = await this.get<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } | null } }[]>(
        `/repos/${repo}/commits?since=${encodeURIComponent(since)}&per_page=30`,
      );
      for (const c of commits)
        events.push({ ...base, providerEventId: c.sha, resourceType: "commit", resourceId: c.sha, title: `${short}: ${firstLine(c.commit.message)}`, summary: c.commit.author?.name ? `by ${c.commit.author.name}` : "", canonicalUrl: c.html_url, occurredAt: c.commit.author?.date ?? now.toISOString(), urgency: 1, why: `New commit on ${repo}, a repo you watch`, dedupeKey: `github:commit:${c.sha}` });

      const pulls = await this.get<{ id: number; number: number; title: string; state: string; merged_at: string | null; updated_at: string; html_url: string; user: { login: string } | null }[]>(
        `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=30`,
      );
      for (const p of pulls.filter((p) => p.updated_at >= since)) {
        const state = p.merged_at ? "merged" : p.state;
        events.push({ ...base, providerEventId: String(p.id), resourceType: "pull_request", resourceId: String(p.number), title: `${short} PR #${p.number} ${state}: ${firstLine(p.title)}`, summary: p.user ? `by ${p.user.login}` : "", canonicalUrl: p.html_url, occurredAt: p.updated_at, urgency: 2, why: `Pull request ${state} on ${repo}`, dedupeKey: `github:pr:${p.id}:${state}` });
      }

      const issues = await this.get<{ id: number; number: number; title: string; state: string; updated_at: string; html_url: string; pull_request?: unknown; comments: number }[]>(
        `/repos/${repo}/issues?state=all&since=${encodeURIComponent(since)}&per_page=30`,
      );
      for (const i of issues.filter((i) => !i.pull_request))
        events.push({ ...base, providerEventId: String(i.id), resourceType: "issue", resourceId: String(i.number), title: `${short} issue #${i.number} ${i.state}: ${firstLine(i.title)}`, summary: `${i.comments} comment${i.comments === 1 ? "" : "s"}`, canonicalUrl: i.html_url, occurredAt: i.updated_at, urgency: 2, why: `Issue activity on ${repo}`, dedupeKey: `github:issue:${i.id}:${i.state}:${i.comments}` });

      try {
        const runs = await this.get<{ workflow_runs: { id: number; name: string; conclusion: string | null; created_at: string; html_url: string; head_branch: string }[] }>(
          `/repos/${repo}/actions/runs?per_page=20&created=${encodeURIComponent(">=" + since.slice(0, 10))}`,
        );
        for (const r of runs.workflow_runs.filter((r) => (r.conclusion === "failure" || r.conclusion === "timed_out") && r.created_at >= since))
          events.push({ ...base, providerEventId: String(r.id), resourceType: "workflow_run", resourceId: String(r.id), title: `${short}: workflow "${r.name}" failed on ${r.head_branch}`, summary: r.conclusion ?? "", canonicalUrl: r.html_url, occurredAt: r.created_at, urgency: 3, why: `A build on ${repo} failed`, dedupeKey: `github:run:${r.id}` });
      } catch (err) {
        // Tokens without Actions permission still get commits/PRs/issues.
        if (!(err instanceof ConnectorError && (err.code === "auth" || err.code === "not_found"))) throw err;
      }

      const releases = await this.get<{ id: number; name: string | null; tag_name: string; published_at: string | null; html_url: string }[]>(`/repos/${repo}/releases?per_page=5`);
      for (const r of releases.filter((r) => r.published_at && r.published_at >= since))
        events.push({ ...base, providerEventId: String(r.id), resourceType: "release", resourceId: r.tag_name, title: `${short} released ${r.name || r.tag_name}`, summary: "", canonicalUrl: r.html_url, occurredAt: r.published_at!, urgency: 2, why: `New release of ${repo}`, dedupeKey: `github:release:${r.id}` });

      next[repo] = now.toISOString();
    }
    return { events, cursor: next };
  }
}
