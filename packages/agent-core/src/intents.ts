import type { MemoryKind, Sensitivity } from "@ultron/schemas";

export type Intent =
  | { type: "remember"; content: string; kind: MemoryKind; sensitivity: Sensitivity }
  | { type: "remember_blocked"; reason: string }
  | { type: "forget"; query: string }
  | { type: "chat" };

const PREFIX = String.raw`^\s*(?:(?:hey|ok|okay)\s+)?(?:ultron[\s,:!.-]+)?(?:please\s+)?`;
const REMEMBER = new RegExp(PREFIX + String.raw`remember(?:\s+that)?[\s,:]+(.+)$`, "is");
const FORGET = new RegExp(PREFIX + String.raw`forget(?:\s+(?:that|about))?[\s,:]+(.+)$`, "is");

// Credentials and identifiers are never stored, even on request.
const BLOCKED: [RegExp, string][] = [
  [/\b(pass(word|code|phrase)|pin\s*(code|number)?|2fa|otp|recovery\s+code|security\s+answer)\b/i, "passwords, PINs, or login codes"],
  [/\b(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{20,}|api[\s_-]?key|secret\s+key|private\s+key|seed\s+phrase)\b/i, "API keys or secret keys"],
  [/\b(?:\d[ -]?){13,19}\b/, "card or account numbers"],
  [/\b\d{3}-\d{2}-\d{4}\b|\bsocial security\b/i, "government ID numbers"],
  [/\b(routing|account|iban|swift)\s+(number|no\.?)\b/i, "bank account details"],
];
const SENSITIVE = /\b(diagnos\w*|medication|prescription|therapy|illness|disease|salary|debt|bank|income|tax(es)?|lawsuit|religio\w*|sexual\w*)\b/i;

export function classifyKind(text: string): MemoryKind {
  if (/\b(prefer|like|love|hate|dislike|favou?rite|always|never|rather)\b/i.test(text)) return "preference";
  if (/\b(project|repo(sitory)?|port|build|codebase|app|game|mod)\b/i.test(text)) return "project";
  return "fact";
}

export function blockedReason(text: string): string | null {
  for (const [re, what] of BLOCKED) if (re.test(text)) return what;
  return null;
}

/** Deterministic detection of explicit memory commands. Everything else is ordinary chat. */
export function detectIntent(message: string): Intent {
  const remember = REMEMBER.exec(message);
  if (remember?.[1]) {
    const raw = remember[1].trim().replace(/[.!\s]+$/, "");
    const reason = blockedReason(raw);
    if (reason) return { type: "remember_blocked", reason };
    const content = raw.charAt(0).toUpperCase() + raw.slice(1);
    return { type: "remember", content, kind: classifyKind(raw), sensitivity: SENSITIVE.test(raw) ? "sensitive" : "normal" };
  }
  const forget = FORGET.exec(message);
  if (forget?.[1]) return { type: "forget", query: forget[1].trim().replace(/[.!?\s]+$/, "") };
  return { type: "chat" };
}
