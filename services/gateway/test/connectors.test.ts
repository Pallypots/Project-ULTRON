import { afterEach, describe, expect, it } from "vitest";
import { GithubConnector } from "../src/connectors/github.ts";
import { startFakeGithub, type FakeGithub } from "./fake-github.ts";
import { replyText, startGateway } from "./helpers.ts";

let fake: FakeGithub | null = null;
let cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
  await fake?.close();
  fake = null;
  delete process.env.ULTRON_GITHUB_API;
});

async function setup() {
  fake = await startFakeGithub();
  process.env.ULTRON_GITHUB_API = fake.url;
  const g = await startGateway();
  cleanup.push(g.close);
  return g;
}

describe("GitHub connector", () => {
  it("maps commits, PRs, issues, failed runs and releases to canonical events", async () => {
    fake = await startFakeGithub();
    const gh = new GithubConnector(fake.token, fake.url);
    const { events, cursor } = await gh.sync(["pallypots/oogie-port"], {});
    const types = events.map((e) => e.resourceType).sort();
    expect(types).toEqual(["commit", "commit", "issue", "pull_request", "release", "workflow_run"]);
    const failed = events.find((e) => e.resourceType === "workflow_run")!;
    expect(failed).toMatchObject({ urgency: 3, title: 'oogie-port: workflow "CI" failed on main', why: "A build on pallypots/oogie-port failed" });
    expect(events.find((e) => e.resourceId === "aaa111")!.title).toBe("oogie-port: Fix renderer shader cache"); // first line only
    expect(cursor["pallypots/oogie-port"]).toMatch(/^\d{4}-/);
  });

  it("explains bad tokens, rate limits and unknown repos", async () => {
    fake = await startFakeGithub();
    await expect(new GithubConnector("wrong-token", fake.url).whoAmI()).rejects.toThrow(/rejected the token/);
    await expect(new GithubConnector(fake.token, fake.url).checkRepo("pallypots/nope")).rejects.toThrow(/Not found/);
    await expect(new GithubConnector(fake.token, fake.url).checkRepo("not a repo")).rejects.toThrow(/owner\/repo/);
    fake.rateLimited = true;
    await expect(new GithubConnector(fake.token, fake.url).whoAmI()).rejects.toMatchObject({ code: "rate_limited", retryAt: expect.any(String) });
  });
});

describe("connected accounts through the gateway", () => {
  it("connect (read test) → pick repos → sync → feed, with dedupe on re-sync", async () => {
    const g = await setup();
    expect((await g.api("POST", "/api/connectors/github/connect", { token: "wrong-token-123" })).status).toBe(401);
    expect((await g.api("GET", "/api/connectors")).body.connectors[0].connected).toBe(false);
    const c = await g.api("POST", "/api/connectors/github/connect", { token: fake!.token });
    expect(c.body.connector).toMatchObject({ connected: true, account: "pallypots", health: "ok" });
    expect(JSON.stringify((await g.api("GET", "/api/connectors")).body)).not.toContain(fake!.token);
    expect((await g.api("GET", "/api/connectors/github/repos")).body.repos.map((r: any) => r.fullName)).toContain("pallypots/oogie-port");
    expect((await g.api("PUT", "/api/connectors/github/repos", { repos: ["pallypots/nope"] })).status).toBe(400);
    await g.api("PUT", "/api/connectors/github/repos", { repos: ["pallypots/oogie-port"] });
    const s1 = await g.api("POST", "/api/connectors/github/sync");
    expect(s1.body.added).toBe(6);
    // Second sync: cursor moved on, nothing new, no duplicates.
    fake!.commits.push({ sha: "ccc333", message: "Tweak menu", date: new Date().toISOString() });
    expect((await g.api("POST", "/api/connectors/github/sync")).body.added).toBe(1);
    expect((await g.api("GET", "/api/feed")).body.events).toHaveLength(7);
    expect((await g.api("GET", "/api/feed?important=1")).body.events.every((e: any) => e.urgency >= 2)).toBe(true);
  });

  it("rate limiting shows the last good sync and backs off", async () => {
    const g = await setup();
    await g.api("POST", "/api/connectors/github/connect", { token: fake!.token });
    await g.api("PUT", "/api/connectors/github/repos", { repos: ["pallypots/oogie-port"] });
    await g.api("POST", "/api/connectors/github/sync");
    const last = (await g.api("GET", "/api/connectors")).body.connectors[0].lastSyncAt;
    fake!.rateLimited = true;
    expect((await g.api("POST", "/api/connectors/github/sync")).status).toBe(429);
    const info = (await g.api("GET", "/api/connectors")).body.connectors[0];
    expect(info).toMatchObject({ health: "rate_limited", lastSyncAt: last });
    expect(new Date(info.nextSyncAt).getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it("the brain gets real updates with feed status, and hostile titles stay data", async () => {
    const g = await setup();
    const none = replyText(await g.chat(await g.newConversation(), "what's new on github?"));
    expect(none).toMatch(/not_connected/);
    await g.api("POST", "/api/connectors/github/connect", { token: fake!.token });
    await g.api("PUT", "/api/connectors/github/repos", { repos: ["pallypots/oogie-port"] });
    await g.api("POST", "/api/connectors/github/sync");
    const id = await g.newConversation();
    const events = await g.chat(id, "what's new on github?");
    expect(events.find((e) => e.type === "tool")).toMatchObject({ event: { tool: "connected_updates", status: "succeeded", risk: 0 } });
    expect(replyText(events)).toMatch(/workflow \\"CI\\" failed/);
    // The issue title tried to order ULTRON around; nothing was approved or run.
    const ran = (await g.api("GET", "/api/actions")).body.actions;
    expect(ran.every((a: any) => a.tool === "connected_updates" && a.risk === 0)).toBe(true);
    expect((await g.api("GET", "/api/actions")).body.pending).toEqual([]);
  });

  it("disconnect deletes the token and every stored event", async () => {
    const g = await setup();
    await g.api("POST", "/api/connectors/github/connect", { token: fake!.token });
    await g.api("PUT", "/api/connectors/github/repos", { repos: ["pallypots/oogie-port"] });
    await g.api("POST", "/api/connectors/github/sync");
    expect((await g.api("DELETE", "/api/connectors/github")).body.eventsDeleted).toBe(6);
    expect((await g.api("GET", "/api/feed")).body.events).toEqual([]);
    expect((await g.api("GET", "/api/connectors")).body.connectors[0].connected).toBe(false);
    expect((await g.api("POST", "/api/connectors/github/sync")).status).toBe(401);
  });
});

describe("GitHub issue drafts (UL-CON-005)", () => {
  async function connected() {
    const g = await setup();
    await g.api("POST", "/api/connectors/github/connect", { token: fake!.token });
    await g.api("PUT", "/api/connectors/github/repos", { repos: ["pallypots/oogie-port"] });
    return g;
  }

  it("drafts, shows the exact text with visibility, and posts only after approval (with AI disclosure)", async () => {
    const g = await connected();
    const id = await g.newConversation();
    const events = await g.chat(id, "draft an issue in pallypots/oogie-port: Crash on level 3 when loading the boss arena");
    const ev = events.find((e) => e.type === "tool") as any;
    expect(ev.event).toMatchObject({ tool: "github_create_issue", status: "awaiting_approval", risk: 2 });
    expect(ev.event.preview).toMatch(/Repository: pallypots\/oogie-port \(private repo\)/);
    expect(ev.event.preview).toMatch(/Title: Crash on level 3/);
    expect(ev.event.preview).toMatch(/AI-assisted/);
    expect(fake!.posted).toHaveLength(0);
    const approved = (await g.api("POST", `/api/actions/${ev.event.executionId}/approve`)).body.action;
    expect(approved.status).toBe("succeeded");
    expect(JSON.parse(approved.result)).toMatchObject({ posted: true, url: "https://github.com/pallypots/oogie-port/issues/101" });
    expect(fake!.posted).toEqual([expect.objectContaining({ repo: "pallypots/oogie-port", title: expect.stringMatching(/^Crash on level 3/), body: expect.stringMatching(/AI-assisted/) })]);
  });

  it("refuses repos you don't watch and explains a read-only token", async () => {
    const g = await connected();
    const id = await g.newConversation();
    const other = (await g.chat(id, "draft an issue in pallypots/ultron: something")).find((e) => e.type === "tool") as any;
    expect(other.event.preview).toMatch(/NOT a watched repo/);
    const r1 = (await g.api("POST", `/api/actions/${other.event.executionId}/approve`)).body.action;
    expect(r1).toMatchObject({ status: "failed", error: expect.stringMatching(/only post to repos you watch/) });
    fake!.canWrite = false;
    const ev = (await g.chat(id, "draft an issue in pallypots/oogie-port: another bug")).find((e) => e.type === "tool") as any;
    const r2 = (await g.api("POST", `/api/actions/${ev.event.executionId}/approve`)).body.action;
    expect(r2).toMatchObject({ status: "failed", error: expect.stringMatching(/Issues.*Read and write/) });
    expect(fake!.posted).toHaveLength(0);
  });
});
