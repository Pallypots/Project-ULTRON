import { describe, expect, it } from "vitest";
import { ENDS_CONVERSATION, isNoise } from "../src/conversation.ts";

describe("conversation mode text rules", () => {
  it("ignores what Whisper 'hears' in background noise", () => {
    for (const t of ["Thank you.", " you ", "[BLANK_AUDIO]", "(music)", "♪♪", "Hmm.", "...", "Thanks for watching!", "Bye."]) expect(isNoise(t), t).toBe(true);
    for (const t of ["Thank you, that helps a lot", "yes do it", "What about tomorrow?", "no"]) expect(isNoise(t), t).toBe(false);
  });
  it("knows when the owner is wrapping up", () => {
    for (const t of ["That's all, thanks.", "ok goodbye", "never mind", "Thanks, I'm done", "talk to you later!", "good night ultron"]) expect(ENDS_CONVERSATION.test(t), t).toBe(true);
    for (const t of ["that's all I needed to know about the oven, what about the dough?", "say goodbye to my sister for me tomorrow when she calls"]) expect(ENDS_CONVERSATION.test(t), t).toBe(false);
  });
});

import { seemsUnfinished } from "../src/index.ts";
describe("seemsUnfinished: waits when you trail off", () => {
  it("spots trailing-off phrases", () => {
    for (const t of ["So I was thinking we could, um.", "I need to buy milk and", "Remind me about the", "Well...", "Tell me about…", "Can you check if"]) expect(seemsUnfinished(t), t).toBe(true);
  });
  it("lets complete sentences through", () => {
    for (const t of ["What's the weather?", "Turn the music up.", "Tell me a joke", "I'm home!", "That's all."]) expect(seemsUnfinished(t), t).toBe(false);
  });
});
