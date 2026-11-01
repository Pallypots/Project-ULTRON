/**
 * Everyday commands handled by code, like reminders (D-016): instant and reliable on any brain, which matters most on a
 * slow local model. Only whole, unambiguous commands match; anything else goes to the model as usual.
 */
export type QuickCommand =
  | { type: "open_url"; url: string }
  | { type: "add_todo"; items: string[] }
  | { type: "list_todos" }
  | { type: "weather"; place: string | null }
  | { type: "calculate"; expression: string }
  | { type: "media"; action: "play_pause" | "next" | "previous" | "mute" | "volume_up" | "volume_down"; steps?: number }
  | { type: "open_app"; name: string }
  | { type: "calendar"; when: "today" | "tomorrow" | "next_7_days" }
  | { type: "convert"; text: string }
  | { type: "define"; word: string }
  | { type: "world_time"; place: string }
  | { type: "lock_pc" }
  | { type: "watch"; url: string; lookFor: string | null }
  | { type: "add_note"; text: string }
  | { type: "list_notes"; query: string | null }
  | { type: "home"; action: "on" | "off" | "brightness" | "set_temperature"; target: string; value?: number };

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
  // "open spotify", "launch notepad": the gateway only uses this if such an app really is in the Start menu.
  const app = /^(?:open|launch|start|run)(?: up)?(?: the)?\s+([\p{L}\p{N}][\p{L}\p{N} .+&'-]{0,40}?)(?:\s+app)?$/iu.exec(m);
  if (app && !/\b(my|file|folder|document|website|page|link|door|doors|window)\b/i.test(app[1]!)) return { type: "open_app", name: app[1]!.trim() };

  // "watch example.com/deal", "tell me when example.com/deal changes", "let me know when <link> says in stock"
  const watch = /^(?:watch|keep an eye on|monitor|(?:tell|let) me (?:know )?when)\s+(\S+?)(?:\s+(?:changes|updates)|\s+(?:says|shows|has|mentions|contains)\s+["“]?(.+?)["”]?)?$/i.exec(m);
  if (watch && (DOMAIN.test(watch[1]!) || /^https?:\/\/\S+$/i.test(watch[1]!)) && (/^(?:watch|keep|monitor)/i.test(m) || /changes|updates|says|shows|has|mentions|contains/i.test(m)))
    return { type: "watch", url: /^https?:\/\//i.test(watch[1]!) ? watch[1]! : `https://${watch[1]}`, lookFor: watch[2]?.trim() || null };

  if (/^lock (?:my |the )?(?:pc|computer|laptop|screen|desktop)(?: now)?$/i.test(m)) return { type: "lock_pc" };

  // Smart home: "turn off the kitchen lights", "lights on", "dim the lights", "set the heating to 21".
  // The gateway only treats these as instant commands if the words match real Home Assistant devices.
  const DEV = "([\\p{L}\\p{N}][\\p{L}\\p{N} '-]{1,50}?)";
  let h: RegExpExecArray | null;
  if ((h = new RegExp(`^(?:turn|switch|put) (on|off) (?:the |my |all (?:the )?)?${DEV}$`, "iu").exec(m))) return { type: "home", action: h[1]!.toLowerCase() as "on" | "off", target: h[2]!.trim() };
  if ((h = new RegExp(`^(?:turn|switch|put) (?:the |my |all (?:the )?)?${DEV} (on|off)$`, "iu").exec(m))) return { type: "home", action: h[2]!.toLowerCase() as "on" | "off", target: h[1]!.trim() };
  if ((h = new RegExp(`^(?:the |all (?:the )?)?${DEV} (on|off)$`, "iu").exec(m)) && /\b(lights?|lamps?|fan|tv|heating|plug)\b/i.test(h[1]!)) return { type: "home", action: h[2]!.toLowerCase() as "on" | "off", target: h[1]!.trim() };
  if ((h = new RegExp(`^dim (?:the |my )?${DEV}(?: to (\\d{1,3}) ?(?:%|percent))?$`, "iu").exec(m))) return { type: "home", action: "brightness", target: h[1]!.trim(), value: Math.min(100, Number(h[2] ?? 30)) };
  if ((h = new RegExp(`^(?:brighten|full brightness on) (?:the |my )?${DEV}$`, "iu").exec(m))) return { type: "home", action: "brightness", target: h[1]!.trim(), value: 100 };
  if ((h = new RegExp(`^set (?:the |my )?${DEV} to (\\d{1,3}) ?(?:%|percent)$`, "iu").exec(m))) return { type: "home", action: "brightness", target: h[1]!.trim(), value: Math.min(100, Number(h[2])) };
  if ((h = /^(?:set|turn) (?:the |my )?(heating|thermostat|temperature|heat|ac|air ?con)(?: (?:up |down )?to) (\d{1,2}(?:\.5)?) ?(?:°|degrees?)?(?: ?[cf])?$/i.exec(m))) return { type: "home", action: "set_temperature", target: h[1]!, value: Number(h[2]) };

  if (/^(?:pause|resume|unpause)(?: the)?(?: music| song| video| track| it| playback)?$|^play(?: the)? (?:music|it)$|^(?:play|pause)$/i.test(m)) return { type: "media", action: "play_pause" };
  if (/^(?:next|skip)(?: this| the)?(?: song| track)?$|^skip (?:this|it)$/i.test(m)) return { type: "media", action: "next" };
  if (/^(?:previous|last|go back a|back a)(?: song| track)$|^play the (?:previous|last) (?:song|track)$/i.test(m)) return { type: "media", action: "previous" };
  if (/^(?:mute|unmute)(?: the)?(?: sound| audio| volume| music)?$/i.test(m)) return { type: "media", action: "mute" };
  const vol = /^(?:turn (?:it|the volume|the music|the sound) (up|down)|volume (up|down)|(louder|quieter)|turn it (up|down))(?: a (lot|little|bit))?$/i.exec(m);
  if (vol) {
    const dir = (vol[1] ?? vol[2] ?? vol[3] ?? vol[4])!.toLowerCase();
    const up = dir === "up" || dir === "louder";
    const steps = vol[5]?.toLowerCase() === "lot" ? 12 : vol[5] ? 3 : 5;
    return { type: "media", action: up ? "volume_up" : "volume_down", steps };
  }

  // Notes: "take a note: …", "jot down …", "note that …"; "read my notes", "what notes do I have about the boiler?"
  const note = /^(?:(?:take|make|add|write|save) (?:a |this )?note(?: of| that| saying)?|note (?:that|down|this)|jot (?:this |that |it )?down(?: that)?)[\s:,-]+(.{2,2000})$/is.exec(m);
  if (note) return { type: "add_note", text: note[1]!.trim() };
  if (/^(?:read|show|list|open)(?: me)? my notes$|^what(?:'s| is| are) (?:in )?my notes$/i.test(m)) return { type: "list_notes", query: null };
  const noteQ = /^(?:what|which|any|do i have any) notes(?: do i have)? (?:about|on|for) (.{2,100})$|^what did i (?:note|jot down|write down) about (.{2,100})$/i.exec(m);
  if (noteQ) return { type: "list_notes", query: (noteQ[1] ?? noteQ[2])!.trim() };

  const add = /^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my|the)\s+(?:to-?do\s+|shopping\s+)?list$/i.exec(m);
  if (add) {
    const items = add[1]!
      .split(/\s*,\s*(?:and\s+)?|\s+and\s+(?=[^,]*$)/i)
      .map((s) => s.trim().replace(/^(?:a|an|some)\s+/i, ""))
      .filter(Boolean);
    if (items.length && items.length <= 10 && items.every((i) => i.length <= 200)) return { type: "add_todo", items };
  }

  const cal = /^(?:what(?:'s| is) (?:on )?my (?:calendar|schedule|agenda)|what do i have (?:on )?|do i have anything (?:on )?|what(?:'s| is) (?:on|happening))\s*(today|tomorrow|this week|for today|for tomorrow)?$/i.exec(m);
  if (cal && (/calendar|schedule|agenda/i.test(m) || cal[1])) {
    const w = (cal[1] ?? "today").replace(/^for /i, "").toLowerCase();
    return { type: "calendar", when: w === "tomorrow" ? "tomorrow" : w === "this week" ? "next_7_days" : "today" };
  }

  if (/^(?:what(?:'s| is)|what do i have) on my (?:to-?do )?list|^(?:show|read)(?: me)? my (?:to-?do )?list$|^(?:what(?:'s| is)|show(?: me)?) my to-?do(?: list)?$/i.test(m)) return { type: "list_todos" };

  const weather = /^(?:what(?:'s| is) the |how(?:'s| is) the )?weather(?: like)?(?:\s+(?:in|for|at)\s+([\p{L}][\p{L} ,.'-]{1,60}?))?(?:\s+(?:today|now|right now))?$/iu.exec(m);
  if (weather) return { type: "weather", place: weather[1]?.trim() || null };

  const calc = /^(?:what(?:'s| is)|calculate|compute|how much is)\s+(.+)$/i.exec(m);
  if (calc) {
    // A comma followed by a space is a spoken pause ("1299 times 0.85, plus 4.99"); "1,299" stays a thousands separator.
    let expr = calc[1]!.trim().replace(/,\s+/g, " ");
    const pct = /^(\d+(?:\.\d+)?)\s*%\s+of\s+(.+)$/i.exec(expr);
    if (pct) expr = `${pct[1]}% * (${pct[2]})`;
    expr = expr.replace(/(\d)\s*x\s*(?=[\d(])/gi, "$1*").replace(/\btimes\b/gi, "*").replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-").replace(/\bdivided by\b/gi, "/");
    // Needs at least one operator; "what is 42" is a question about the number, not maths.
    if (MATHS.test(expr) && /\d/.test(expr) && /[-+*/^%x×÷]/.test(expr.replace(/^-/, ""))) return { type: "calculate", expression: expr };
  }

  // "5 miles to km", "how many cups in a litre", "50 dollars in euros": the gateway checks the units are real.
  if (/^(?:convert\s+|what(?:'s| is)\s+|how much is\s+)?[$€£¥]?-?\d[\d.,]*\s*[\p{L}°$€£¥'"²/. ]*?\s+(?:to|in|into)\s+[\p{L}°$€£¥'"²/. ]+$|^how many\s+[\p{L}°'"²/. ]+\s+(?:are )?(?:in|is)\s+(?:\d[\d.]*|an?|one)\s+[\p{L}°'"²/. ]+$/iu.test(m))
    return { type: "convert", text: m };

  // Only clear dictionary requests: "what's the meaning of life" is a conversation, not a lookup.
  const define = /^(?:define|what does\s+(.+?)\s+mean)\s*(.*)$/i.exec(m);
  if (define) {
    const word = (define[1] ?? define[2] ?? "").replace(/^["'“]|["'”]$/g, "").trim();
    if (word && word.split(/\s+/).length <= 3) return { type: "define", word };
  }

  const tz = /^(?:what(?:'s| is) the time|what time is it|time) in\s+([\p{L}][\p{L} ,.'-]{1,60})$/iu.exec(m);
  if (tz) return { type: "world_time", place: tz[1]!.trim() };
  return null;
}
