import type { ToolDef } from "./tools.ts";

/**
 * Small local models get confused by a long tool list (in CI, a 2B model "requested approval" in words without calling
 * any tool). So for local brains we offer only the tools a message plausibly needs. Cloud models get everything.
 */
const GROUPS: { when: RegExp; tools: string[] }[] = [
  { when: /\b(remind|reminder|timer|alarm|wake me|in \d+ (?:min|minute|hour|second)s?)\b/i, tools: ["create_reminder", "list_reminders", "cancel_reminder"] },
  { when: /\b(to-?do|my list|on the list|tasks?|tick|cross off|finished|done with|i (?:did|paid|bought|called|sent|emailed|booked))\b/i, tools: ["add_todo", "list_todos", "complete_todo"] },
  { when: /https?:\/\/|www\.|\.(?:com|org|net|io|dev|co\.uk)\b|\b(website|web ?page|link|article|site|open)\b/i, tools: ["open_website", "read_webpage"] },
  { when: /\b(files?|folders?|documents?|docs?|pull up|find|search|notes?|projects?|read)\b/i, tools: ["search_files", "read_file", "open_on_screen"] },
  { when: /\d\s*[-+*/x×÷^]\s*\d|\d\s*%|\b(calculate|percent|%|tip|split|total|sum|average|times|divided|plus|minus|how much|convert)\b/i, tools: ["calculate"] },
  { when: /\b(who (?:is|was|were)|what (?:is|was|are) (?:a|an|the)\b|tell me about|look up|wikipedia|history of|when did|where is)\b/i, tools: ["lookup_wikipedia"] },
  { when: /\b(weather|rain|raining|snow|forecast|temperature|cold|hot|sunny|umbrella|jacket|wind)\b/i, tools: ["get_weather"] },
  { when: /\b(github|repo|repository|issues?|commits?|pull requests?|prs?|ci|builds?)\b|what'?s new|any updates/i, tools: ["connected_updates", "github_create_issue"] },
  { when: /\b(morning|brief|briefing|my day|catch me up|agenda|today)\b/i, tools: ["daily_briefing"] },
  { when: /\b(time|date|day is it|what day)\b/i, tools: ["get_current_time"] },
  { when: /\b(we (?:talked|discussed|spoke|chatted|said)|did i (?:say|tell|mention)|i (?:told|mentioned|said)|last (?:time|week|month)|yesterday|remember when|earlier|before|conversations?)\b/i, tools: ["search_conversations"] },
  // Personal statements are where "want me to remember that?" comes from.
  { when: /\b(my|i'm|i am|i've|i have|i'll|i will|we're)\b/i, tools: ["save_memory"] },
];

export function focusTools(recentUserTexts: string[], all: ToolDef[]): ToolDef[] {
  const text = recentUserTexts.join("\n");
  const wanted = new Set<string>();
  for (const g of GROUPS) if (g.when.test(text)) g.tools.forEach((t) => wanted.add(t));
  return all.filter((t) => wanted.has(t.name));
}

/**
 * Catches a reply that says something was done or queued when no tool actually ran this turn
 * (e.g. "I've set a reminder", "approval requested"). Models can't be trusted to report actions honestly.
 */
const CLAIM =
  /\b(approval (?:has been |was |is )?(?:requested|queued|pending|required|needed)|(?:needs?|requires?|awaits?) your approval|(?:waiting|awaiting|wait) (?:for )?your approval|(?:I'?ve|I have|I) (?:just |now |gone ahead and |already )?(?:set|added|created|scheduled|opened|saved|remembered|ticked off|crossed off|cancell?ed|posted|queued(?: up)?|initiated|launched|booked|sent)\b[^.!?\n]{0,60}\b(reminders?|timers?|alarms?|list|memory|issues?|websites?|pages?|browser|files?|folders?|requests?|links?|tabs?|emails?|messages?))/i;

export function claimsUnbackedAction(text: string): boolean {
  return CLAIM.test(text);
}

export const HONESTY_NOTE =
  "\n\n(Correction from ULTRON's safety check: nothing was actually done or queued in that reply. No action ran. Ask again, more directly if needed, and you'll see an action card when something really happens.)";
