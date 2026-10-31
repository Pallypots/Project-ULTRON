// Text rules for hands-free conversation mode (no wake word during a follow-up, so these guard what gets sent).

// Whisper "hears" these in background noise; without a wake word they must not become messages.
const NOISE = /^\W*(?:thank you|thanks for watching|you|bye|okay|oh|um+|uh+|hmm+|\[[^\]]*\]|\([^)]*\)|♪+)?\W*$/i;
// Ending the conversation: ULTRON gets the message (so it can say goodbye) but stops waiting for a reply after it.
export const ENDS_CONVERSATION = /\b(?:that'?s all|that'?s it|goodbye|good night|bye(?: bye)?|see you|stop listening|never ?mind|nothing else|i'?m done|talk (?:to you )?later)\b(?:[,\s]+(?:thanks|thank you|ultron|mate|buddy|man|for now))*[.!\s]*$/i;

export function isNoise(text: string): boolean {
  return NOISE.test(text.trim());
}
