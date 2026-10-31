/**
 * Everyday commands handled by code, like reminders (D-016): instant and reliable on any brain, which matters most on a
 * slow local model. Only whole, unambiguous commands match; anything else goes to the model as usual.
 */
export type QuickCommand =
  | { type: "open_url"; url: string }
  | { type: "add_todo"; items: string[] }
  | { type: "list_todos" }
  | { type: "weather"; place: string | null }
  | { type: "calculate"; expression: string };

const LEAD = /^\s*(?:(?:hey|ok|okay)\s+)?(?:ultron[\s,:!.-]+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?/i;
const TAIL = /(?:[\s,]+please)?[\s?.!]*$/i;

function core(message: string): string {
  return message.replace(LEAD, "").replace(TAIL, "").trim();
}

const DOMAIN = /^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;
const MATHS = /^[\d\s+\-*/^%().,x×÷]+$/i;

export function detectQuickCommand(message: string): QuickCommand | null {
  if (message.length > 300 || message.includes("\n")) return null;
  const m = core(message);

  const open = /^open(?: up)?(?: the (?:website|site|page|link))?\s+(\S+)$/i.exec(m);
  if (open && DOMAIN.test(open[1]!)) return { type: "open_url", url: /^https?:\/\//i.test(open[1]!) ? open[1]! : `https://${open[1]}` };

  const add = /^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my|the)\s+(?:to-?do\s+|shopping\s+)?list$/i.exec(m);
  if (add) {
    const items = add[1]!
      .split(/\s*,\s*(?:and\s+)?|\s+and\s+(?=[^,]*$)/i)
      .map((s) => s.trim().replace(/^(?:a|an|some)\s+/i, ""))
      .filter(Boolean);
    if (items.length && items.length <= 10 && items.every((i) => i.length <= 200)) return { type: "add_todo", items };
  }

  if (/^(?:what(?:'s| is)|what do i have) on my (?:to-?do )?list|^(?:show|read)(?: me)? my (?:to-?do )?list$|^(?:what(?:'s| is)|show(?: me)?) my to-?do(?: list)?$/i.test(m)) return { type: "list_todos" };

  const weather = /^(?:what(?:'s| is) the |how(?:'s| is) the )?weather(?: like)?(?:\s+(?:in|for|at)\s+([\p{L}][\p{L} ,.'-]{1,60}?))?(?:\s+(?:today|now|right now))?$/iu.exec(m);
  if (weather) return { type: "weather", place: weather[1]?.trim() || null };

  const calc = /^(?:what(?:'s| is)|calculate|compute|how much is)\s+(.+)$/i.exec(m);
  if (calc) {
    let expr = calc[1]!.trim();
    const pct = /^(\d+(?:\.\d+)?)\s*%\s+of\s+(.+)$/i.exec(expr);
    if (pct) expr = `${pct[1]}% * (${pct[2]})`;
    expr = expr.replace(/(\d)\s*x\s*(?=[\d(])/gi, "$1*").replace(/\btimes\b/gi, "*").replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-").replace(/\bdivided by\b/gi, "/");
    // Needs at least one operator; "what is 42" is a question about the number, not maths.
    if (MATHS.test(expr) && /\d/.test(expr) && /[-+*/^%x×÷]/.test(expr.replace(/^-/, ""))) return { type: "calculate", expression: expr };
  }
  return null;
}
