import { describe, expect, it } from "vitest";
import { SentenceSplitter, toSpeakable } from "../src/index.ts";

describe("toSpeakable", () => {
  it("removes markdown, citations, links, code and emoji", () => {
    expect(toSpeakable("**Done!** I saved it [memory:abcd1234]. See https://example.com/x 🎉\n- item one\n`npm test`")).toBe("Done! I saved it . See a link item one npm test");
    expect(toSpeakable("```js\nconst x=1\n```")).toBe("(code shown on screen)");
    expect(toSpeakable("[the docs](https://a.b/c) say so")).toBe("the docs say so");
  });
});

describe("SentenceSplitter", () => {
  it("emits complete sentences as text streams in", () => {
    const s = new SentenceSplitter(10);
    const out: string[] = [];
    for (const chunk of ["Good eve", "ning, sir. The weather is ", "mild today! Shall I ", "continue?"]) out.push(...s.push(chunk));
    expect(out).toEqual(["Good evening, sir.", "The weather is mild today!"]);
    expect(s.flush()).toEqual(["Shall I continue?"]);
  });
  it("does not split on abbreviations or decimals, and merges very short fragments", () => {
    const s = new SentenceSplitter(10);
    const out = s.push("Use e.g. version 3.5 of it. Ok. Then we go on to the next part. ");
    expect(out).toEqual(["Use e.g. version 3.5 of it.", "Ok. Then we go on to the next part."]);
  });
});

describe("SentenceSplitter: speaking starts at the first pause of a long opening sentence", () => {
  it("emits the opening clause early, then whole sentences", () => {
    const s = new SentenceSplitter();
    expect(s.push("Well, that is a remarkably ambitious plan for a Tuesday afternoon, and I")).toEqual(["Well, that is a remarkably ambitious plan for a Tuesday afternoon,"]);
    expect(s.push(" approve of it entirely. Shall we begin, then, with the part where")).toEqual(["and I approve of it entirely."]);
    expect(s.flush()).toEqual(["Shall we begin, then, with the part where"]);
  });
  it("doesn't split numbers like 1,299", () => {
    const s = new SentenceSplitter();
    expect(s.push("The total comes to roughly 1,299 pounds once you add the delivery and the")).toEqual([]);
  });
});

