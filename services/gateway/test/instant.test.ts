import { afterEach, describe, expect, it } from "vitest";
import { startFakeOllama, type FakeOllama } from "./fake-ollama.ts";
import { replyText, startGateway } from "./helpers.ts";

// 3.6: everyday commands are answered instantly by ULTRON itself (no brain, so well under a second even on a slow PC);
// open-ended questions always reach the brain (never hijacked by a pattern).
export const COMMANDS = [
  "what time is it", "what's the date today", "what day is it", "set a timer for 5 minutes", "remind me in 10 minutes to check the oven",
  "remind me to call mum at 6pm", "cancel my reminders", "what are my reminders", "add milk to my list", "what's on my list",
  "take a note: the spare key is under the blue pot", "read my notes", "pause the music", "play music", "skip this song", "turn it up",
  "volume down", "mute", "lights off", "turn on the kitchen lights", "what's the weather", "what's the weather tomorrow", "will it rain today",
  "what's 15% of 84.50", "what is 17 times 23", "convert 5 miles to km", "how many cups in a litre", "50 dollars in euros",
  "what time is it in tokyo", "define serendipity", "what's the news", "any new emails", "what's on my calendar today", "good morning, brief me",
  "how's my pc doing", "lock my pc", "open notepad", "stop", "that's all", "remember that my sister's birthday is march 3rd",
];
const OPEN_ENDED = [
  "what do you think about artificial intelligence?", "tell me a joke", "I had a rough day at work", "should I learn the guitar or the piano?",
  "explain how vaccines work", "write a short poem about rain", "what's the meaning of life?", "help me plan a birthday party for my sister",
  "why is the sky blue?", "can you recommend a good book?", "how do I make pancakes?", "what would you do if you were human?",
  "I'm thinking of changing jobs", "compare cats and dogs as pets", "what's your favourite movie?", "give me three ideas for dinner",
  "how does a car engine work?", "tell me something interesting", "what should I name my dog?", "summarise the plot of Hamlet",
];

let fake: FakeOllama | null = null;
afterEach(async () => fake?.close());

async function brainCalls(say: string[]) {
  fake = await startFakeOllama();
  process.env.ULTRON_OLLAMA_URL = fake.url;
  process.env.ULTRON_ACTIONS_DRY_RUN = "1";
  const g = await startGateway();
  delete process.env.ULTRON_OLLAMA_URL;
  await g.api("POST", "/api/local-ai/use", { model: "gemma4:e2b" });
  const out: { say: string; brain: boolean; ms: number; reply: string }[] = [];
  try {
    for (const s of say) {
      const before = fake.requests.filter((r) => r.path === "/api/chat").length;
      const t = performance.now();
      const reply = replyText(await g.chat(await g.newConversation(), s));
      out.push({ say: s, brain: fake.requests.filter((r) => r.path === "/api/chat").length > before, ms: performance.now() - t, reply });
    }
  } finally {
    await g.close();
  }
  return out;
}

describe("instant answers for everyday commands (3.6)", () => {
  it("handles everyday commands without the brain", async () => {
    const r = await brainCalls(COMMANDS);
    const slow = r.filter((x) => x.brain).map((x) => x.say);
    console.log(`[instant] ${COMMANDS.length - slow.length}/${COMMANDS.length} instant; went to the brain: ${JSON.stringify(slow)}`);
    expect(slow.length).toBeLessThanOrEqual(4);
  }, 120_000);

  it("negative control: open-ended questions always reach the brain", async () => {
    const r = await brainCalls(OPEN_ENDED);
    const hijacked = r.filter((x) => !x.brain).map((x) => `${x.say} → ${x.reply.slice(0, 50)}`);
    expect(hijacked).toEqual([]);
  }, 120_000);
});

describe("the morning briefing, read out at once", async () => {
  const { briefingText } = await import("../src/chat.ts");
  it("says what's there in plain English and never invents what isn't connected", () => {
    const morning = new Date(2026, 10, 2, 8, 30);
    const full = briefingText(
      {
        weather: { found: true, place: "Leeds", now: { conditions: "Light rain", temperature: "9°C" }, next_days: [{ low: "6°C", high: "11°C", chance_of_rain: "70%" }] },
        calendar_today: ["9:30 AM Dentist"],
        reminders_today: [{ text: "call Mum", at: "6:00 PM" }],
        todo_list: ["milk", "eggs"],
        pending_approvals: [],
        untrusted_top_news_bbc: ["Headline one", "Headline two"],
        not_connected: ["YouTube"],
      },
      morning,
    );
    expect(full).toMatch(/^Good morning\. It's Monday, 2 November|^Good morning\. It's Monday, November 2/);
    expect(full).toMatch(/In Leeds it's light rain, 9°C; today 6°C to 11°C, 70% chance of rain\./);
    expect(full).toMatch(/On your calendar: 9:30 AM Dentist\./);
    expect(full).toMatch(/Reminders: call Mum at 6:00 PM\./);
    expect(full).toMatch(/On your list: milk, eggs\./);
    expect(full).not.toMatch(/Not connected/);
    // Negative control: nothing connected, nothing on → no invented calendar or email, and it says so.
    const bare = briefingText({ weather: "no home city set", calendar_today: "not connected", not_connected: ["calendar", "email"] }, new Date(2026, 10, 2, 20, 0));
    expect(bare).toMatch(/^Good evening/);
    expect(bare).not.toMatch(/On your calendar|unread email/);
    expect(bare).toMatch(/Not connected: calendar and email/);
  });
});
