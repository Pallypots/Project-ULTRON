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
