// Contract test against the real GitHub API, using the read-only token GitHub Actions provides for this repo.
// Runs only when ULTRON_TEST_GITHUB=1 (CI).
import { describe, expect, it } from "vitest";
import { GithubConnector } from "../src/connectors/github.ts";

const enabled = process.env.ULTRON_TEST_GITHUB === "1" && process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY;

describe.skipIf(!enabled)("real GitHub API (this repository, read-only)", () => {
  it("syncs commits and runs for this repo with the documented shapes", async () => {
    const gh = new GithubConnector(process.env.GITHUB_TOKEN!);
    const repo = process.env.GITHUB_REPOSITORY!;
    expect((await gh.checkRepo(repo)).fullName.toLowerCase()).toBe(repo.toLowerCase());
    const { events } = await gh.sync([repo], {});
    const counts = events.reduce<Record<string, number>>((m, e) => ((m[e.resourceType] = (m[e.resourceType] ?? 0) + 1), m), {});
    const summary = `repo=${repo} events=${JSON.stringify(counts)} latest="${events.find((e) => e.resourceType === "commit")?.title ?? ""}"`;
    console.log(`[github] ${summary}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Real GitHub connector (${process.platform})::${summary}`);
    expect(counts.commit).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.canonicalUrl).toMatch(/^https:\/\/github\.com\//);
      expect(e.dedupeKey).toMatch(/^github:/);
    }
  }, 120_000);
});
