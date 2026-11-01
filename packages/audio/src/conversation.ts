// Text rules for hands-free conversation mode (no wake word during a follow-up, so these guard what gets sent).

// Whisper "hears" these in background noise; without a wake word they must not become messages.
const NOISE = /^\W*(?:thank you|thanks for watching|you|bye|okay|oh|um+|uh+|hmm+|\[[^\]]*\]|\([^)]*\)|♪+)?\W*$/i;
// Ending the conversation: ULTRON gets the message (so it can say goodbye) but stops waiting for a reply after it.
export const ENDS_CONVERSATION = /\b(?:that'?s all|that'?s it|goodbye|good night|bye(?: bye)?|see you|stop listening|never ?mind|nothing else|i'?m done|talk (?:to you )?later)\b(?:[,\s]+(?:thanks|thank you|ultron|mate|buddy|man|for now))*[.!\s]*$/i;

export function isNoise(text: string): boolean {
  return NOISE.test(text.trim());
}

/**
 * Does this transcript sound like the speaker paused mid-thought ("so I was thinking we could, um")? Then ULTRON waits a
 * moment for the rest instead of answering half a sentence. Whisper often adds a full stop even when you trail off,
 * so trailing punctuation (other than "?" and "!") is ignored.
 */
export function seemsUnfinished(text: string): boolean {
  const t = text.trim();
  if (!t || /[?!]$/.test(t)) return false;
  if (/(?:\.\.\.|…|,|-|–)$/.test(t)) return true;
  const last = t.replace(/[.\s]+$/, "").split(/\s+/).pop()?.toLowerCase() ?? "";
  return /^(?:and|but|so|or|because|cause|um+|uh+|er+|erm|hmm+|like|the|a|an|to|of|with|if|then|that|which|my|your|our|their|is|was|for|about|maybe|also|plus|when|where|while|until|in|on|at|from|could|would|should|can|will|i|we|you|it's|i'm)$/.test(last);
}
