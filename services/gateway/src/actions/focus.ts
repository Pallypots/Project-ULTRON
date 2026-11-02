import type { ToolDef } from "./tools.ts";

/**
 * Small local models get confused by a long tool list (in CI, a 2B model "requested approval" in words without calling
 * any tool). So for local brains we offer only the tools a message plausibly needs. Cloud models get everything.
 */
const GROUPS: { when: RegExp; tools: string[] }[] = [
  { when: /\b(remind|reminder|timer|alarm|wake me|in \d+ (?:min|minute|hour|second)s?)\b/i, tools: ["create_reminder", "list_reminders", "cancel_reminder"] },
  { when: /\b(news|headlines?|happening in the world|what'?s going on)\b/i, tools: ["get_news"] },
  { when: /\b(e-?mails?|inbox|mail|gmail|messages? from|wrote to me|replied)\b/i, tools: ["check_email", "read_email"] },
  { when: /\b(notes?|jot|write (?:that|this|it) down|noted)\b/i, tools: ["add_note", "list_notes"] },
  { when: /\b(to-?do|my list|on the list|tasks?|tick|cross off|finished|done with|i (?:did|paid|bought|called|sent|emailed|booked))\b/i, tools: ["add_todo", "list_todos", "complete_todo"] },
  { when: /https?:\/\/|www\.|\.(?:com|org|net|io|dev|co\.uk)\b|\b(website|web ?page|link|article|site|open)\b/i, tools: ["open_website", "read_webpage"] },
  { when: /\b(files?|folders?|documents?|docs?|pull up|find|search|notes?|projects?|read)\b/i, tools: ["search_files", "read_file", "open_on_screen"] },
  { when: /\d\s*[-+*/x×÷^]\s*\d|\d\s*%|\b(calculate|percent|%|tip|split|total|sum|average|times|divided|plus|minus|how much|convert)\b/i, tools: ["calculate"] },
  { when: /\b(who (?:is|was|were)|what (?:is|was|are) (?:a|an|the)\b|tell me about|look up|wikipedia|history of|when did|where is)\b/i, tools: ["lookup_wikipedia"] },
  { when: /\b(search|google|online|on the web|internet|latest|news|current(?:ly)?|recent(?:ly)?|right now|price|prices|cost|reviews?|who won|score|open now|hours|near me|release date)\b/i, tools: ["web_search", "read_webpage"] },
  { when: /\b(convert|conversion|how many|in (?:km|miles|kg|pounds|lbs|cups|ml|liters|litres|celsius|fahrenheit|feet|meters|metres)|°[cf])\b/i, tools: ["convert_units"] },
  { when: /\b(currency|exchange rate|dollars?|euros?|pounds?|yen|rupees?|bucks|usd|eur|gbp|[$€£¥])\b|[$€£¥]\d/i, tools: ["convert_currency"] },
  { when: /\b(define|definition|meaning of|what does .+ mean|spell|synonym)\b/i, tools: ["define_word"] },
  { when: /\b(time (?:is it )?in|time zone|timezone|what time .+ in)\b/i, tools: ["world_time"] },
  { when: /\b(watch|monitor|keep an eye|let me know when|tell me when|in stock|back in stock|price drop|changes?)\b/i, tools: ["watch_page", "list_watchers", "stop_watching"] },
  { when: /\b(weather|rain|raining|snow|forecast|temperature|cold|hot|sunny|umbrella|jacket|wind)\b/i, tools: ["get_weather"] },
  { when: /\b(github|repo|repository|issues?|commits?|pull requests?|prs?|ci|builds?)\b|what'?s new|any updates/i, tools: ["connected_updates", "github_create_issue"] },
  { when: /\b(morning|brief|briefing|my day|catch me up|agenda|today)\b/i, tools: ["daily_briefing"] },
  { when: /\b(calendar|schedule|meetings?|appointments?|events?|busy|free|plans?|tomorrow|this week|next week|today)\b/i, tools: ["get_calendar"] },
  // (No time tool: the local brain gets the current time with every message.)
  { when: /\b(we (?:talked|discussed|spoke|chatted|said)|did i (?:say|tell|mention)|i (?:told|mentioned|said)|last (?:time|week|month)|yesterday|remember when|earlier|before|conversations?)\b/i, tools: ["search_conversations"] },
  { when: /\b(about me|know me|learned about|remember about|my (?:life|profile|details|preferences))\b/i, tools: ["recall_everything_about_owner"] },
  { when: /\b(music|song|track|play|pause|resume|skip|volume|louder|quieter|mute|unmute|spotify)\b/i, tools: ["media_control"] },
  { when: /\b(open|launch|start|run|apps?|programs?|installed)\b/i, tools: ["open_app", "find_apps"] },
  { when: /\b(lights?|lamps?|bulbs?|dim|brighter|plugs?|sockets?|fan|heating|thermostat|temperature|blinds?|curtains?|garage|gate|vacuum|hoover|tv|scene|home|house|turn (?:on|off)|switch (?:on|off))\b/i, tools: ["home_devices", "home_control", "home_cover_or_script"] },
  { when: /\b(pc|computer|laptop|battery|disk|storage|space|memory|ram|cpu|uptime|running slow)\b/i, tools: ["pc_status"] },
  // Lasting personal facts are where "want me to remember that?" comes from. Kept narrow on purpose: offering tools on
  // every "I'm"/"my" changed the local brain's prompt on most turns and made it re-read the whole conversation.
  { when: /\b(birthday|anniversary|allergic|allergy|my (?:wife|husband|partner|girlfriend|boyfriend|sister|brother|mum|mom|dad|father|mother|son|daughter|kids?|dog|cat)\b|i (?:always|never|prefer|hate|love) )/i, tools: ["save_memory"] },
];

/**
 * "core" mode (experiment, ULTRON_LOCAL_TOOLS=core): the same short list of the most useful tools with every message, so
 * the start of the prompt never changes and the brain never has to re-read its instructions because the tools changed.
 */
export const CORE_TOOLS = ["calculate", "get_weather", "create_reminder", "lookup_wikipedia", "web_search", "open_website", "save_memory", "get_calendar", "add_todo", "search_conversations"];
export const localToolMode = (): "core" | "focused" => (process.env.ULTRON_LOCAL_TOOLS === "core" ? "core" : "focused");
export function localTools(recentUserTexts: string[], all: ToolDef[]): ToolDef[] {
  if (localToolMode() === "core") return CORE_TOOLS.map((n) => all.find((t) => t.name === n)).filter((t): t is ToolDef => Boolean(t));
  return focusTools(recentUserTexts, all);
}

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
