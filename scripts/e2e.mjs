// End-to-end check of the real built app in a real browser (Chromium via Playwright).
// Usage: npm run build && npm run test:e2e   (screenshots land in docs/screenshots)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
// A pretend private calendar link (like Google's "secret address in iCal format") with an event this afternoon.
const icsStamp = (h) => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
};
const calServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/calendar" });
  res.end(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:e2e", "SUMMARY:Dentist", `DTSTART:${icsStamp(23)}`, `DTEND:${icsStamp(23)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
});
await new Promise((r) => calServer.listen(0, "127.0.0.1", r));
const calUrl = `http://127.0.0.1:${calServer.address().port}/basic.ics`;
// A pretend Start menu, so "open notepad" has something to find on any OS.
const startMenu = join(dataDir, "..", `ultron-e2e-startmenu-${process.pid}`);
mkdirSync(startMenu, { recursive: true });
writeFileSync(join(startMenu, "Notepad.lnk"), "");
const shots = join(import.meta.dirname, "../docs/screenshots");
mkdirSync(shots, { recursive: true });

// Stand-in for the local AI engine (Ollama) so the local-brain UI can be exercised without a real model.
const fakeOllama = spawn(process.execPath, ["--import", "tsx", "scripts/fake-ollama.ts"], { stdio: ["ignore", "pipe", "inherit"] });
const ollamaUrl = await new Promise((resolve, reject) => {
  fakeOllama.stdout.on("data", (d) => {
    const m = /FAKE_OLLAMA_URL=(\S+)/.exec(String(d));
    if (m) resolve(m[1]);
  });
  setTimeout(() => reject(new Error("fake Ollama did not start")), 20000);
});

const fakeGithub = spawn(process.execPath, ["--import", "tsx", "scripts/fake-github.ts"], { stdio: ["ignore", "pipe", "inherit"] });
const [githubUrl, githubToken] = await new Promise((resolve, reject) => {
  fakeGithub.stdout.on("data", (d) => {
    const m = /FAKE_GITHUB_URL=(\S+) FAKE_GITHUB_TOKEN=(\S+)/.exec(String(d));
    if (m) resolve([m[1], m[2]]);
  });
  setTimeout(() => reject(new Error("fake GitHub did not start")), 20000);
});

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "services/gateway/src/main.ts"], {
  env: { ...process.env, ULTRON_PORT: String(port), ULTRON_DATA_DIR: dataDir, ULTRON_PROVIDER: "mock", ULTRON_STT_ENGINE: "mock", ULTRON_TTS_ENGINE: "mock", ULTRON_ACTIONS_DRY_RUN: "1", ULTRON_MOCK_TRANSCRIPT_PREFIX: "Ultron, ", ULTRON_EMBEDDINGS: "mock", ULTRON_OLLAMA_URL: ollamaUrl, ULTRON_GITHUB_API: githubUrl, ULTRON_LOG_LEVEL: "warn", ULTRON_START_MENU_DIRS: startMenu, ULTRON_ALLOW_PRIVATE_FETCH: "1" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes("online") && resolve());
  server.on("exit", (c) => reject(new Error(`gateway exited ${c}`)));
  setTimeout(() => reject(new Error("gateway did not start")), 20000);
});

const base = `http://localhost:${port}`;
const speech = join(import.meta.dirname, "../services/gateway/test/fixtures/jfk.wav");
// Fake microphone that plays the JFK speech sample, with the permission prompt auto-accepted.
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${speech}`, "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// CI machines (especially Windows) can be slow; give each step more room than a desktop would need.
page.setDefaultTimeout(process.env.CI ? 45000 : 30000);
const passed = [];
const recent = [];
page.on("response", (r) => {
  if (!r.url().includes("/api/health")) recent.push(`${r.request().method()} ${r.url().replace(/.*\/api/, "/api")} ${r.status()}`);
  if (recent.length > 25) recent.shift();
});
page.on("pageerror", (e) => recent.push(`pageerror: ${e.message}`));
const step = (name) => {
  passed.push(name);
  console.log(`✓ ${name}`);
};
let failed = false;
try {
  await page.goto(base);
  await page.getByText("Online").first().waitFor();
  await page.getByText("Standing by").first().waitFor();
  await page.locator(".hello", { hasText: "I'm ULTRON" }).waitFor();
  const spoke = page.waitForRequest((r) => r.url().includes("/api/voice/speak"));
  await page.getByRole("button", { name: "Say it out loud" }).click();
  await spoke;
  step("Home HUD loads, shows Online, and ULTRON greets first (and can say it out loud)");
  await page.waitForTimeout(500); // let the greeting fade in
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

  // ---- Voice (UL-008) ----
  await page.getByLabel("High contrast").uncheck();
  await page.getByLabel(/Reduce motion/).uncheck();
  await page.getByText("Ready").first().waitFor();
  await page.getByRole("button", { name: "🎙 Test microphone" }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector(".meter i");
    return el && /scaleX\((0\.[1-9]|1)/.test(el.getAttribute("style") ?? "");
  }, null, { timeout: 8000 });
  await page.getByRole("button", { name: "■ Stop test" }).click();
  step("Settings → Voice: microphone test meter responds to audio");

  await page.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  const talk = page.getByRole("button", { name: /Push to talk/ });
  const userVoiceMsgs = page.locator(".msg--user", { hasText: "🎙 voice" });
  const lastVoiceText = async () => (await userVoiceMsgs.last().locator(".msg__body").innerText());
  const level = (t) => Number(/level ([\d.]+)/.exec(t)?.[1] ?? 0);
  const secs = (t) => Number(/of ([\d.]+) seconds/.exec(t)?.[1] ?? 0);

  // 1) Hold the button.
  const box2 = await talk.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.locator(".listening", { hasText: "Listening" }).waitFor();
  if (!(await page.locator(".core--listening").count())) throw new Error("HUD core not in listening state");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(shots, "06-push-to-talk-listening.png") });
  await page.mouse.up();
  await userVoiceMsgs.first().waitFor();
  let t = await lastVoiceText();
  if (secs(t) < 2 || level(t) < 0.005) throw new Error(`hold-to-talk captured no real audio: ${t}`);
  await page.locator(".msg--assistant.msg--complete").last().waitFor();
  step(`Hold-to-talk: mic audio captured and sent as a voice message (${secs(t)} s, level ${level(t)})`);
  await page.screenshot({ path: join(shots, "07-voice-message-sent.png") });

  // Spoken reply to a voice message, then barge-in.
  await page.locator(".listening--speaking").waitFor({ timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".core--speaking"), null, { timeout: 5000 });
  step("Reply to a voice message is spoken aloud (sentence by sentence)");

  // 2) Hold Space (focus outside text fields) — also interrupts the spoken reply.
  await page.locator(".messages").click({ position: { x: 5, y: 5 } });
  await page.keyboard.down("Space");
  await page.locator(".listening", { hasText: "Listening" }).waitFor();
  if (await page.locator(".listening--speaking").count()) throw new Error("ULTRON kept speaking after the owner started talking");
  step("Barge-in: starting to talk silences ULTRON instantly");
  await page.waitForTimeout(1500);
  await page.keyboard.up("Space");
  await userVoiceMsgs.nth(1).waitFor();
  step("Hold Space: push-to-talk works from the keyboard");
  await page.locator(".msg--assistant.msg--complete").nth(1).waitFor();

  // Esc while speaking stops the voice.
  await page.locator(".listening--speaking").waitFor({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await page.locator(".listening--speaking").waitFor({ state: "detached", timeout: 3000 });
  step("Esc stops ULTRON speaking");

  // 3) Esc cancels and discards.
  const before = await userVoiceMsgs.count();
  await talk.click();
  await page.locator(".listening", { hasText: "Listening" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".listening").waitFor({ state: "detached" });
  await page.waitForTimeout(800);
  if ((await userVoiceMsgs.count()) !== before) throw new Error("Esc did not discard the recording");
  step("Esc cancels a recording and nothing is sent");

  // 4) Click to latch hands-free, click again to send.
  await talk.click();
  await page.locator(".listening", { hasText: "Listening" }).waitFor();
  await page.waitForTimeout(1800);
  await talk.click();
  await userVoiceMsgs.nth(before).waitFor();
  t = await lastVoiceText();
  if (secs(t) < 1.5) throw new Error(`latched recording too short: ${t}`);
  step("Click-to-start / click-to-send hands-free mode works");
  await page.locator(".msg--assistant.msg--complete").last().waitFor();

  // 5) Review-before-send mode puts the transcript in the box.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByText("Spoken replies").waitFor();
  await page.getByRole("button", { name: "▶ Preview voice" }).click();
  await page.getByRole("button", { name: "■ Stop", exact: true }).waitFor();
  await page.screenshot({ path: join(shots, "10-spoken-replies-settings.png") });
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  step("Settings → Spoken replies: preview plays and can be stopped");
  await page.getByLabel(/Send right after I stop talking/).uncheck();
  await page.getByRole("button", { name: "Chat" }).click();
  await talk.click();
  await page.locator(".listening", { hasText: "Listening" }).waitFor();
  await page.waitForTimeout(1200);
  await talk.click();
  await page.waitForFunction(() => document.querySelector("#composer")?.value.includes("Mock transcript"), null, { timeout: 8000 });
  step("Review mode: transcript lands in the message box for editing");

  await page.getByRole("button", { name: "Activity" }).click();
  await page.getByText(/Microphone used/).first().waitFor();
  step("Activity log records microphone use (not the audio or words)");

  // 6) Microphone blocked → clear explanation.
  const noMic = await chromium.launch();
  const ctx = await noMic.newContext();
  const denied = await ctx.newPage();
  await denied.goto(`${base}/#chat`);
  await denied.getByRole("button", { name: /Push to talk/ }).click();
  await denied.getByText(/Microphone access is blocked|No microphone was found/).waitFor();
  await noMic.close();
  step("Blocked/missing microphone shows a plain-English fix");

  // ---- Actions & reminders (UL-010) ----
  await page.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await page.getByText("Say hello, ask a question").waitFor();
  const composer = page.getByLabel("Message ULTRON");
  await composer.fill("set a timer for 3 seconds");
  await composer.press("Enter");
  await page.getByText(/Reminder set: "Your 3-second timer is done"/).waitFor();
  await page.locator(".toast", { hasText: "Your 3-second timer is done" }).waitFor({ timeout: 15000 });
  step("Timer set by voice-style command fires on time as a pop-up");
  await page.locator(".toast").getByRole("button", { name: "Dismiss" }).first().click();

  await composer.fill("open https://example.com/news");
  await composer.press("Enter");
  const chip = page.locator(".tool--awaiting_approval", { hasText: "Open example.com" });
  await chip.waitFor();
  await page.locator(".nav__item", { hasText: "Activity" }).locator(".badge").waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(shots, "11-approval-needed.png") });
  await chip.getByRole("button", { name: "Approve" }).click();
  await page.locator(".tool--succeeded", { hasText: "Open example.com" }).waitFor({ timeout: 20000 });
  step("External action waits for Approve, then runs once (dry-run in tests)");

  await page.getByRole("button", { name: "Send", exact: true }).waitFor(); // previous reply finished
  // Approving mid-reply must not be undone when the reply finishes.
  await page.locator(".tool--succeeded", { hasText: "Open example.com" }).waitFor();
  await composer.fill("my sister's birthday is March 3");
  await composer.press("Enter");
  const offer = page.locator(".tool--awaiting_approval", { hasText: "Remember" });
  await offer.getByText("Their sister's birthday is March 3").first().waitFor();
  await page.screenshot({ path: join(shots, "18-offer-to-remember.png") });
  await offer.getByRole("button", { name: "Approve" }).click();
  await page.locator(".tool--succeeded", { hasText: "Remember" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Memory Vault" }).click();
  await page.getByText("Their sister's birthday is March 3").first().waitFor();
  await page.getByRole("button", { name: "Chat" }).click();
  step("ULTRON offers to remember a personal fact; saved only after Approve");

  await page.getByRole("button", { name: "Send", exact: true }).waitFor();
  await composer.fill("add buy milk and call mum to my list");
  await composer.press("Enter");
  await page.locator(".tool--succeeded", { hasText: "Add to your to-do list" }).waitFor();
  await page.getByRole("button", { name: "Reminders" }).click();
  await page.locator(".todo", { hasText: "Call mum" }).waitFor();
  await page.getByLabel("Done: Buy milk").click();
  await page.locator(".todo--done", { hasText: "Buy milk" }).waitFor();
  await page.screenshot({ path: join(shots, "19-todo-list.png") });
  await page.getByRole("button", { name: "Chat" }).click();
  step("To-do list: items added by chat appear in the app and can be ticked off");

  await page.getByRole("button", { name: "Send", exact: true }).waitFor();
  await composer.fill("open notepad");
  await composer.press("Enter");
  const appCard = page.locator(".tool--awaiting_approval", { hasText: 'Open the app "Notepad"' });
  await appCard.getByText("Notepad.lnk").first().waitFor();
  await appCard.getByRole("button", { name: "Approve" }).click();
  await page.locator(".tool--succeeded", { hasText: 'Open the app "Notepad"' }).waitFor();
  step('"Open notepad": approval card names the exact Start-menu app, opens only after Approve');

  await page.getByRole("button", { name: "Reminders" }).click();
  await page.locator(".reminder--past", { hasText: "3-second timer" }).waitFor();
  await page.getByLabel("Reminder", { exact: true }).fill("Check the oven");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator(".reminder", { hasText: "Check the oven" }).waitFor();
  await page.screenshot({ path: join(shots, "12-reminders.png") });
  await page.locator(".reminder", { hasText: "Check the oven" }).getByRole("button", { name: "Cancel" }).click();
  await page.locator(".reminder--past", { hasText: "Check the oven" }).waitFor();
  step("Reminders page: fired timer listed; add and cancel a reminder");

  await page.getByRole("button", { name: "Activity" }).click();
  await page.locator("td", { hasText: "Open example.com" }).first().waitFor();
  step("Activity lists actions with risk level and who asked");

  // ---- Hands-free wake word ----
  await page.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await page.getByText("Say hello, ask a question").waitFor();
  await page.getByRole("button", { name: "🎧 Hands-free" }).click();
  await page.locator(".listening--hands").waitFor();
  await page.screenshot({ path: join(shots, "14-hands-free.png") });
  await page.locator(".msg--user", { hasText: "🎙 voice" }).first().waitFor({ timeout: 30000 });
  const heard = await page.locator(".msg--user .msg__body").first().innerText();
  if (/^ultron/i.test(heard)) throw new Error(`wake word was not stripped: ${heard}`);
  await page.locator(".msg--assistant.msg--complete").first().waitFor();
  step(`Hands-free: speech addressed to "Ultron" is picked up without pressing anything ("${heard.slice(0, 40)}…")`);

  // Conversation mode: after the answer, ULTRON keeps listening and the next phrase needs no wake word.
  const followUp = page.waitForRequest((r) => r.url().includes("/api/voice/transcribe") && !r.url().includes("mode=wake"), { timeout: 30000 });
  await page.locator(".listening--followup").waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(shots, "20-conversation-mode.png") });
  await followUp;
  await page.locator(".msg--user", { hasText: "🎙 voice" }).nth(1).waitFor({ timeout: 30000 });
  step("Conversation mode: after answering, ULTRON listens for a reply without the wake word");
  await page.getByRole("button", { name: "Hands-free on" }).click();
  await page.locator(".listening--hands").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Activity" }).click();
  await page.getByText("Hands-free listening turned ON").first().waitFor();
  step("Hands-free can be turned off, and on/off is recorded in Activity");

  // One click from Home: a fresh conversation that's already listening (no wake word for the first sentence).
  await page.getByRole("button", { name: "Home" }).click();
  const firstWords = page.waitForRequest((r) => r.url().includes("/api/voice/transcribe") && !r.url().includes("mode=wake"), { timeout: 30000 });
  await page.getByRole("button", { name: "🎙 Talk to ULTRON" }).click();
  await page.locator(".listening--followup").waitFor();
  await firstWords;
  await page.locator(".msg--user", { hasText: "🎙 voice" }).first().waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Hands-free on" }).click();
  step('"Talk to ULTRON" on Home opens a conversation that listens straight away');

  // Interrupt by voice (opt-in): with it on, talking while ULTRON speaks stops it and the next words are taken as the reply.
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("ultron.voice") ?? "{}");
    localStorage.setItem("ultron.voice", JSON.stringify({ ...p, bargeIn: true, speakMode: "voice" }));
  });
  const interrupted = page.waitForEvent("console", { predicate: (m) => m.text().includes("[ultron] interrupted by voice"), timeout: 45000 });
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "🎙 Talk to ULTRON" }).click();
  await interrupted;
  await page.locator(".msg--user", { hasText: "🎙 voice" }).nth(1).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Hands-free on" }).click();
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("ultron.voice") ?? "{}");
    localStorage.setItem("ultron.voice", JSON.stringify({ ...p, bargeIn: false }));
  });
  step("Interrupt by voice: talking over ULTRON stops it and the next words are taken as the reply");

  // ---- Files / second brain ----
  // Windows temp lives in AppData, which ULTRON refuses to index; use a folder inside the repo there.
  const projectsBase = process.platform === "win32" ? join(import.meta.dirname, "../.test-tmp") : tmpdir();
  mkdirSync(projectsBase, { recursive: true });
  const projects = mkdtempSync(join(projectsBase, "ultron-e2e-projects-"));
  mkdirSync(join(projects, "Free School Community"));
  writeFileSync(join(projects, "Free School Community", "launch-plan.md"), "Community launch: weekly AI workshops and onboarding checklist.");
  writeFileSync(join(projects, ".env"), "SECRET=never-index-me");
  await page.getByRole("button", { name: "Files" }).click();
  await page.getByLabel("Folder path").fill(process.platform === "win32" ? "C:\\Windows" : "/etc");
  await page.getByRole("button", { name: "Add folder" }).click();
  await page.getByText(/System and credential folders can't be indexed|doesn't exist/).waitFor();
  await page.getByLabel("Folder path").fill(projects);
  await page.getByRole("button", { name: "Add folder" }).click();
  await page.locator(".reminder", { hasText: "✓" }).waitFor({ timeout: 15000 });
  await page.getByLabel("Search files").fill("workshops");
  await page.getByRole("button", { name: "Search" }).click();
  await page.locator(".file-hit", { hasText: "launch-plan.md" }).waitFor();
  await page.getByLabel("Search files").fill("never-index-me");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByText("No matches").waitFor();
  await page.screenshot({ path: join(shots, "13-files.png") });
  step("Files: system folder refused, project folder indexed, search works, secrets never indexed");
  await page.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await page.getByText("Say hello, ask a question").waitFor();
  await page.getByLabel("Message ULTRON").fill("pull up the free school community");
  await page.getByLabel("Message ULTRON").press("Enter");
  await page.locator(".tool--succeeded", { hasText: "Search your files" }).waitFor();
  await page.locator(".msg--assistant", { hasText: "launch-plan.md" }).waitFor();
  step('"Pull up …" searches approved files (read-only, no approval needed)');

  // ---- Connected Life Hub: GitHub ----
  await page.getByRole("button", { name: "Connections" }).click();
  await page.getByLabel("GitHub token").fill("github_pat_wrong_token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByText(/rejected the token/).waitFor();
  await page.getByLabel("GitHub token").fill(githubToken);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByText("Connected. Now pick the repos to watch.").waitFor();
  await page.getByRole("button", { name: "Choose repos" }).click();
  await page.getByLabel("pallypots/oogie-port").check();
  await page.getByRole("button", { name: "Save & sync" }).click();
  await page.locator(".feed", { hasText: 'workflow "CI" failed' }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: join(shots, "15-connections-github.png") });
  step("GitHub: bad token refused, real read test before 'connected', repo picked, feed synced");
  await page.getByRole("button", { name: "Important" }).click();
  await page.locator(".feed", { hasText: "Add Android build target" }).waitFor({ state: "detached", timeout: 5000 });
  await page.locator(".feed", { hasText: 'workflow "CI" failed' }).waitFor();
  await page.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await page.getByText("Say hello, ask a question").waitFor();
  await page.getByLabel("Message ULTRON").fill("what's new on github?");
  await page.getByLabel("Message ULTRON").press("Enter");
  await page.locator(".tool--succeeded", { hasText: "Check what's new on github" }).waitFor();
  await page.locator(".msg--assistant.msg--complete", { hasText: "connected_updates" }).waitFor();
  step("Asking \"what's new on GitHub?\" uses the real synced feed (read-only)");
  await page.getByLabel("Message ULTRON").fill("draft an issue in pallypots/oogie-port: Crash on level 3 when loading the boss arena");
  await page.getByLabel("Message ULTRON").press("Enter");
  const draft = page.locator(".tool--awaiting_approval", { hasText: "Post a GitHub issue to pallypots/oogie-port" });
  await draft.waitFor();
  await draft.locator("pre", { hasText: "Repository: pallypots/oogie-port (private repo)" }).waitFor();
  await draft.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(shots, "17-github-issue-draft.png") });
  await draft.getByRole("button", { name: "Approve" }).click();
  await page.locator(".tool--succeeded", { hasText: "✓ posted" }).waitFor();
  step("GitHub issue: drafted with full preview (repo, visibility, text), posted only after Approve");

  await page.getByRole("button", { name: "Connections" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByText("Disconnected; GitHub data deleted.").waitFor();
  await page.getByText("Connect an account to see updates here.").waitFor();
  step("Disconnect deletes the token and all GitHub data");

  await page.getByLabel("Private iCal address").fill(calUrl);
  await page.getByRole("button", { name: "Connect calendar" }).click();
  await page.getByText(/Connected\. Found 1 event/).waitFor();
  await page.getByRole("button", { name: "What's on today?" }).click();
  await page.locator(".msg--assistant", { hasText: "Dentist" }).waitFor();
  step("Calendar: private iCal link connected in Connections; 'what's on today?' lists the event");

  // ---- Personality + morning briefing ----
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel(/How it addresses you/).fill("sir");
  await page.getByRole("button", { name: "Save personality" }).click();
  await page.getByText("Saved. ULTRON's next reply uses the new personality.").waitFor();
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("heading", { name: /, sir\.$/ }).waitFor();
  step("Personality editor: salutation saved and used on the Home screen");
  await page.getByRole("button", { name: "Good morning, brief me" }).click();
  await page.locator(".tool--succeeded", { hasText: "Put together your briefing" }).waitFor();
  const briefMsg = page.locator(".msg--assistant.msg--complete", { hasText: "daily_briefing" }).last();
  await briefMsg.waitFor();
  const brief = await briefMsg.locator(".msg__body").innerText();
  if (!/not_connected/.test(brief)) throw new Error("briefing didn't report unconnected sources");
  await page.screenshot({ path: join(shots, "16-morning-briefing.png") });
  step("Good-morning briefing gathers reminders/approvals/feeds and admits what isn't connected");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Reset to default" }).click();
  await page.getByText("Back to the default personality.").waitFor();

  // ---- Local brain (UL-011) ----
  const brain = () => page.evaluate(() => document.documentElement.dataset.brain);
  if ((await brain()) !== "test") throw new Error(`expected test skin, got ${await brain()}`);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel(/Local AI on this PC/).check();
  await page.getByText("Local AI engine running").waitFor();
  await page.getByText("This computer:").waitFor();
  await page.getByText("Recommended for this PC").waitFor();
  await page.getByLabel("Other model name").fill("qwen3:8b");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await page.getByRole("button", { name: "Use it" }).waitFor({ timeout: 15000 });
  step("Local AI panel: engine detected, hardware shown, model downloaded with progress");
  await page.getByRole("button", { name: "Use it" }).click();
  await page.getByText("Now using qwen3:8b locally.").waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.brain === "local", null, { timeout: 8000 });
  await page.locator(".pill", { hasText: "local · qwen3:8b" }).waitFor({ timeout: 8000 });
  await page.screenshot({ path: join(shots, "08-local-ai-setup.png") });
  step("Switched to the local brain: status pill and red local skin");

  await page.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await page.getByText("Say hello, ask a question").waitFor();
  const say = async (text) => {
    const n = await page.locator(".msg--assistant.msg--complete").count();
    await page.getByLabel("Message ULTRON").fill(text);
    await page.getByLabel("Message ULTRON").press("Enter");
    await page.locator(".msg--assistant.msg--complete").nth(n).waitFor();
    return page.locator(".msg--assistant .msg__body").nth(n).innerText();
  };
  if ((await say("Hello there")) !== "Hello from local.") throw new Error("local brain did not answer");
  step("Chat answered by the local model (thinking hidden)");
  await say("Ultron, switch to the test brain");
  await page.waitForFunction(() => document.documentElement.dataset.brain === "test", null, { timeout: 8000 });
  const back = await say("go local");
  if (!/running entirely on this computer/.test(back)) throw new Error(`unexpected: ${back}`);
  await page.waitForFunction(() => document.documentElement.dataset.brain === "local", null, { timeout: 8000 });
  const cloud = await say("switch your brain to Fable 5");
  if (!/needs an Anthropic API key/.test(cloud)) throw new Error(`unexpected: ${cloud}`);
  await page.screenshot({ path: join(shots, "09-brain-switching.png") });
  step("Brain switching by chat: test ↔ local skins change; cloud refused without a key");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base);
  await mobile.getByText("Online").first().waitFor();
  await mobile.screenshot({ path: join(shots, "05-mobile-width.png") });
  step("Layout works at phone width");

  // ---- Phone access over Tailscale (simulated: the "phone" reaches ULTRON through a pretend tailnet address) ----
  const TAILNET = "e2e-pc.tail0000.ts.net";
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("This PC's Tailscale address").fill(TAILNET);
  await page.getByRole("button", { name: "Turn phone access on" }).click();
  await page.getByRole("button", { name: "Pair a phone" }).click();
  const shown = (await page.locator(".pair__code strong").innerText()).replace(/\s/g, "");
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // What `tailscale serve` does: HTTPS on the tailnet name, forwarded to ULTRON on the PC with that Host.
  await phoneCtx.route(`https://${TAILNET}/**`, async (route) => {
    const u = new URL(route.request().url());
    // The live event stream never ends, which this simple forwarder can't relay; the phone works without it.
    if (u.pathname === "/api/events") return route.abort().catch(() => {});
    try {
      const response = await route.fetch({ url: `${base}${u.pathname}${u.search}`, headers: { ...route.request().headers(), host: TAILNET } });
      await route.fulfill({ response });
    } catch {
      /* the phone was closed mid-request */
    }
  });
  const phonePage = await phoneCtx.newPage();
  await phonePage.goto(`https://${TAILNET}/`);
  await phonePage.getByRole("heading", { name: "Pair with ULTRON" }).waitFor();
  await phonePage.getByLabel("Code from your PC").fill(shown);
  await phonePage.getByRole("button", { name: "Pair" }).click();
  await phonePage.getByText("Online").first().waitFor();
  await phonePage.screenshot({ path: join(shots, "21-phone-paired.png") });
  step("Phone access: a phone pairs with the code shown on the PC and gets in");
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator(".device", { hasText: "Phone" }).getByRole("button", { name: "Remove" }).click();
  await phonePage.reload();
  await phonePage.getByRole("heading", { name: "Pair with ULTRON" }).waitFor();
  await phoneCtx.unrouteAll({ behavior: "ignoreErrors" });
  await phoneCtx.close();
  step("Removing the phone on the PC locks it out immediately");

  server.kill();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByText("isn't responding").waitFor({ timeout: 12000 });
  step("UI shows a clear offline message when the service stops");
} catch (err) {
  failed = true;
  console.error("✗ E2E failed:", err.message);
  console.error("  recent requests:\n   " + recent.join("\n   "));
  const lastMessages = (await page.locator(".msg").allInnerTexts().catch(() => [])).slice(-3).map((t) => t.replace(/\s+/g, " ").slice(0, 300));
  console.error("  last messages on screen:\n   " + lastMessages.join("\n   "));
  if (process.env.GITHUB_ACTIONS) {
    const oneLine = (s) => String(s).replace(/\r?\n/g, " ⏎ ").slice(0, 1500);
    console.log(`::error title=Browser E2E failed (${process.platform}) after "${passed.at(-1) ?? "start"}"::${oneLine(err.message)} || screen: ${oneLine(lastMessages.join(" | "))} || recent: ${oneLine(recent.filter((r) => !r.includes("/api/status")).slice(-12).join(" | "))}`);
  }
  await page.screenshot({ path: join(shots, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
  fakeOllama.kill();
  fakeGithub.kill();
  calServer.close();
}
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Browser E2E (${process.platform})::${failed ? "FAILED" : "all steps passed"}: ${passed.join(" | ")}`);
process.exit(failed ? 1 : 0);
