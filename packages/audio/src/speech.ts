// Turning assistant text into something pleasant to hear, sentence by sentence.

/** Strips things that shouldn't be read aloud: markdown, citation tags, code, raw URLs, emoji. */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[memory:[0-9a-f]{4,}\]/gi, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*|__|\*|_(?=\S)|~~/g, "")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Incrementally splits streamed text into sentences so speech can start before the reply finishes.
 * push() returns any sentences completed by the new text; flush() returns the remainder.
 */
export class SentenceSplitter {
  private buf = "";
  constructor(private minChars = 24) {}

  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    // A sentence ends at . ! ? … (or a newline) followed by whitespace. Avoid splitting "e.g. " or "3.5".
    const re = /([.!?…]+["')\]]*|\n)(\s+)/g;
    let start = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[1]!.length;
      const candidate = this.buf.slice(start, end).trim();
      const lastWord = candidate.split(/\s+/).pop() ?? "";
      if (/^(e\.g|i\.e|etc|mr|mrs|ms|dr|vs|st|no)\.$/i.test(lastWord)) continue;
      if (candidate.length < this.minChars && m[1] !== "\n") continue;
      if (candidate) out.push(candidate);
      start = end + m[2]!.length;
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = "";
    return rest ? [rest] : [];
  }
}
