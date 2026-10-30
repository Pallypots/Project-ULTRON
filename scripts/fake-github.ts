// Starts the test stand-in for the GitHub API and prints its URL and token (used by the browser E2E test).
import { startFakeGithub } from "../services/gateway/test/fake-github.ts";

const fake = await startFakeGithub();
console.log(`FAKE_GITHUB_URL=${fake.url} FAKE_GITHUB_TOKEN=${fake.token}`);
