import { describe, expect, it } from "vitest";
import { matchWake } from "../src/index.ts";

describe("wake word", () => {
  it.each([
    ["Ultron, what time is it?", "what time is it?"],
    ["Hey Ultron set a timer for 5 minutes", "set a timer for 5 minutes"],
    ["ok ultron.", ""],
    ["Ultra, remind me at 5 to call mom", "remind me at 5 to call mom"],
    ["Ul tron what's the weather", "what's the weather"],
    ["Altron open my project folder", "open my project folder"],
    ["Ultrin, switch your brain to local", "switch your brain to local"],
  ])("%s", (said, command) => expect(matchWake(said)).toBe(command));

  it.each(["What time is it?", "I was watching the Ultron movie last night", "Uh, so anyway", "", "Alright then"])("ignores: %s", (said) => {
    expect(matchWake(said)).toBeNull();
  });

  it("supports custom wake names", () => {
    expect(matchWake("Jarvis, lights", ["Jarvis"])).toBe("lights");
    expect(matchWake("Ultron, lights", ["Jarvis"])).toBeNull();
  });
});
