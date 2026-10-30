// Wake-word matching on transcribed text. Speech recognizers often mishear "Ultron", so we accept close variants,
// but only at the start of an utterance (optionally after "hey"/"ok"), so the word in the middle of a sentence doesn't wake ULTRON.

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

const FILLER = new Set(["hey", "hi", "ok", "okay", "yo", "oh", "uh", "um", "so", "and"]);

/**
 * If the utterance is addressed to ULTRON, returns the command after the wake word ("" if only the name was said).
 * Returns null when the speech wasn't for ULTRON (it is then discarded by the caller).
 */
export function matchWake(transcript: string, wakeNames: string[] = ["Ultron"]): string | null {
  const words = transcript.trim().split(/\s+/);
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "");
  let i = 0;
  while (i < words.length && FILLER.has(norm(words[i]!))) i++;
  for (const name of wakeNames.map((n) => n.toLowerCase().replace(/[^a-z]/g, ""))) {
    // Try one word ("ultron", "ultra") and two words ("ul tron", "all tron").
    for (const span of [1, 2]) {
      if (i + span > words.length) continue;
      const heard = words.slice(i, i + span).map(norm).join("");
      if (!heard) continue;
      const tolerance = name.length >= 6 ? 2 : 1;
      if (heard === name || editDistance(heard, name) <= tolerance || (name === "ultron" && /^(ultra|ultrons?|altron|ultran|ulton|aultron)$/.test(heard))) {
        return words
          .slice(i + span)
          .join(" ")
          .replace(/^[\s,.:;!?-]+/, "")
          .trim();
      }
    }
  }
  return null;
}
