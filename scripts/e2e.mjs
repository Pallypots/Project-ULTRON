// End-to-end check of the real built app in a real browser (Chromium via Playwright).
// Usage: npm run build && npm run test:e2e   (screenshots land in docs/screenshots)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright isn't installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
}

const port = 7499;
const dataDir = mkdtempSync(join(tmpdir(), "ultron-e2e-"));
const shots = join(import.meta.dirname, "../docs/screenshots");
mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "services/gateway/src/main.ts"], {
  env: { ...process.env, ULTRON_PORT: String(port), ULTRON_DATA_DIR: dataDir, ULTRON_PROVIDER: "mock", ULTRON_LOG_LEVEL: "warn" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes("online") && resolve());
  server.on("exit", (c) => reject(new Error(`gateway exited ${c}`)));
  setTimeout(() => reject(new Error("gateway did not start")), 20000);
});

const base = `http://localhost:${port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const step = (name) => console.log(`✓ ${name}`);
let failed = false;
try {
  await page.goto(base);
  await page.getByText("Online").first().waitFor();
  await page.getByText("Standing by").first().waitFor();
  step("Home HUD loads and shows Online");
  await page.screenshot({ path: join(shots, "01-home.png") });

  await page.getByRole("button", { name: "Chat" }).click();
  const box = page.getByLabel("Message ULTRON");
  await box.fill("Remember that I prefer instructions that say whether preheating is needed.");
  await box.press("Enter");
  await page.getByText("Saved to Memory Vault").waitFor();
  step("'Remember…' saves a memory from chat");

  await page.getByRole("button", { name: "+ New conversation" }).click();
  await box.fill("How should you write cooking instructions for me? Mention preheating?");
  await box.press("Enter");
  await page.locator(".msg--assistant .tag", { hasText: "memory:" }).first().waitFor();
  await page.locator(".msg--assistant.msg--complete").last().waitFor();
  step("New conversation recalls the memory with a citation");
  await page.screenshot({ path: join(shots, "02-chat-memory-recall.png") });

  await page.reload();
  await page.locator(".msg--assistant", { hasText: "preheating is needed" }).first().waitFor();
  step("Conversation survives a page reload");

  await page.getByRole("button", { name: "Memory Vault" }).click();
  await page.getByText("I prefer instructions that say whether preheating is needed").waitFor();
  await page.screenshot({ path: join(shots, "03-memory-vault.png") });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Forget" }).click();
  await page.getByText("Nothing saved yet").waitFor();
  step("Memory Vault lists and deletes the memory");

  await page.getByRole("button", { name: "Activity" }).click();
  await page.getByText("Memory forgotten").waitFor();
  step("Activity log records the deletion");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByText("Language model").waitFor();
  await page.screenshot({ path: join(shots, "04-settings.png") });
  await page.getByLabel("High contrast").check();
  await page.getByLabel(/Reduce motion/).check();
  if ((await page.evaluate(() => document.documentElement.dataset.contrast)) !== "high") throw new Error("high contrast not applied");
  step("Accessibility toggles apply");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base);
  await mobile.getByText("Online").first().waitFor();
  await mobile.screenshot({ path: join(shots, "05-mobile-width.png") });
  step("Layout works at phone width");

  server.kill();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByText("isn't responding").waitFor({ timeout: 12000 });
  step("UI shows a clear offline message when the service stops");
} catch (err) {
  failed = true;
  console.error("✗ E2E failed:", err.message);
  await page.screenshot({ path: join(shots, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
