/**
 * Privacy shield for cloud brains: before anything leaves the PC, obvious secrets in the text are replaced with labels.
 * Local brains see the text as written (it never leaves the PC). Conservative patterns; the original text stays in ULTRON.
 */
const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
};

const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  // API keys and tokens
  [/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, "[secret key hidden]"],
  // "password: hunter2", "my pin is 1234", "passcode = abc"
  [/\b(pass(?:word|code|phrase)|pin(?: code| number)?|2fa code|one[- ]time code|security answer)(\s*(?:is|:|=)\s*)(\S+)/gi, (_m, label: string, sep: string) => `${label}${sep}[hidden]`],
  // Card numbers (13–19 digits, Luhn-valid), with spaces or dashes
  [/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (luhn(m.replace(/[ -]/g, "")) ? "[card number hidden]" : m)],
  // US social security numbers
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[ID number hidden]"],
  // IBANs
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, "[bank account hidden]"],
];

export function shield(text: string): { text: string; hidden: number } {
  let hidden = 0;
  let out = text;
  for (const [re, rep] of RULES) {
    out = out.replace(re, (...args) => {
      const m = args[0] as string;
      const r = typeof rep === "string" ? rep : rep(m, ...(args.slice(1, -2) as string[]));
      if (r !== m) hidden++;
      return r;
    });
  }
  return { text: out, hidden };
}
