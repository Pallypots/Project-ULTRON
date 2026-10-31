import { describe, expect, it } from "vitest";
import { detectQuickCommand as d } from "../src/quick-intents.ts";

describe("quick commands (answered by code, no model)", () => {
  it("recognises clear everyday commands", () => {
    expect(d("open https://example.com/news")).toEqual({ type: "open_url", url: "https://example.com/news" });
    expect(d("Ultron, open github.com please")).toEqual({ type: "open_url", url: "https://github.com" });
    expect(d("add milk, eggs and bread to my list")).toEqual({ type: "add_todo", items: ["milk", "eggs", "bread"] });
    expect(d("put call mum on my to-do list")).toEqual({ type: "add_todo", items: ["call mum"] });
    expect(d("what's on my list?")).toEqual({ type: "list_todos" });
    expect(d("what's the weather like in Leeds, UK today?")).toEqual({ type: "weather", place: "Leeds, UK" });
    expect(d("what's the weather?")).toEqual({ type: "weather", place: null });
    expect(d("what's 15% of 80?")).toEqual({ type: "calculate", expression: "15% * (80)" });
    expect(d("calculate 12 x 7")).toEqual({ type: "calculate", expression: "12*7" });
    expect(d("what's 3 times 4")).toEqual({ type: "calculate", expression: "3 * 4" });
  });

  it("leaves anything ambiguous or conversational to the brain", () => {
    for (const t of [
      "open the pod bay doors",
      "open my project folder",
      "what is 42",
      "what is the meaning of life",
      "what's the weather going to do tomorrow",
      "will it rain later?",
      "I'd like you to open https://example.com",
      "add a reminder to the list to check",
      "open https://example.com\nand also tell me a joke",
    ])
      expect(d(t), t).toBeNull();
  });
});
