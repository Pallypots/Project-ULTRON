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
    // Symbols a voice would otherwise skip or spell out.
    .replace(/(\d)\s?°\s?C\b/g, "$1 degrees Celsius")
    .replace(/(\d)\s?°\s?F\b/g, "$1 degrees Fahrenheit")
    .replace(/(\d)\s?°/g, "$1 degrees")
    .replace(/(\d)\s?%/g, "$1 percent")
    .replace(/(\d)\s?km\/h\b/g, "$1 kilometres an hour")
    .replace(/(\d)\s?mph\b/g, "$1 miles an hour")
    .replace(/\s&\s/g, " and ")
    .replace(/(\d)\s?[–-]\s?(\d)/g, "$1 to $2")
    .replace(/\s[–—]\s/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Incrementally splits streamed text into sentences so speech can start before the reply finishes.
 * push() returns any sentences completed by the new text; flush() returns the remainder.
 */
export class SentenceSplitter {
  private buf = "";
  private spoken = 0;
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
      // The very first sentence may be short ("Sure thing."): get it out at once; later ones are merged for rhythm.
      if (candidate.length < (this.spoken === 0 && !out.length ? 8 : this.minChars) && m[1] !== "\n") continue;
      if (candidate) out.push(candidate);
      start = end + m[2]!.length;
    }
    this.buf = this.buf.slice(start);
    // Talk sooner: if the very first sentence is long, start speaking at its first natural pause (a comma, colon or
    // dash after a few words) instead of waiting for the full stop. Later sentences keep their natural rhythm.
    if (!out.length && this.spoken === 0) {
      // First natural pause after at least three words and 15 characters (the moment it's known to be a pause).
      const pause = /^((?:\S+\s+){2,}?\S*[,;:—–])\s+/s.exec(this.buf);
      if (pause && pause[1]!.length >= 15 && !/\d[,.]$/.test(pause[1]!)) {
        out.push(pause[1]!.trim());
        this.buf = this.buf.slice(pause[0].length);
      }
    }
    this.spoken += out.length;
    return out;
  }

  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = "";
    return rest ? [rest] : [];
  }
}
