# Overnight report: 1 November 2026 (v0.23 to v0.25)

## What you asked for, and what changed

**"Half the time I open it, it says ULTRON's service isn't responding."** Fixed at the root. There were four causes:
1. The service lived inside the black launcher window, so closing that window stopped ULTRON. It now runs in the
   background under a watchdog that restarts it if it ever stops.
2. One stray error anywhere could stop the whole service. Errors are now written to a log
   (`%APPDATA%\ULTRON\logs`) instead.
3. Unpacking a new download over an old one left mismatched files behind. The launcher now spots this and reinstalls
   and rebuilds by itself.
4. Windows PowerShell treated harmless npm warnings, and a missing system command, as fatal. Both are fixed and
   tested on a real Windows machine: the online test starts ULTRON, kills it, checks it comes back, then quits it.

Also: the app only says "Reconnecting" after two missed checks, not when ULTRON is just busy. And **Settings → System →
Quit ULTRON** stops it properly.

**"I want the interface to truly look like Jarvis."** Home is now a command centre:
- An arc reactor in the middle, with a ring of 12 command buttons and live CPU/memory gauges.
- A big clock and an AI core status list.
- A system monitor (CPU, RAM, disk, uptime), weather, and a home systems panel.
- A live feed (approvals, reminders, unread email, accounts) and today's timeline.

Sci-fi fonts are built in, and every screen uses the same angled HUD panels.

**"A face mode… call it Council mode, like the Master Control Program."** Click **Council** (menu or Home), or say
"council mode":
- A full-screen red 3D wireframe face, with rings and a voice waveform around it.
- The mouth moves with his voice, the eyes glow brighter when he listens, and the head turns slightly to follow your
  pointer.
- The microphone stays open (no wake word), he greets you out loud, uses his deeper Council voice, and you can talk
  over him. Subtitles show what he says.
- Leave with Esc or by saying "that's all".

**"An AI I can have real conversations with."**
- Spoken replies are now short and conversational: the answer first, room for you to reply, and no reading out lists.
- He starts talking at the first pause of a long sentence.
- If you trail off ("and, um…") he waits for the rest instead of answering half a sentence.
- You get 15 seconds to reply before he needs his name again.

## New things he can do (all tested)
| Say | What happens |
|---|---|
| "Lights off", "dim the lights to 20%", "set the heating to 21" | Smart home through Home Assistant (Connections → Smart home). Garage doors, blinds and scenes ask first. Locks and alarms are never controlled. |
| "Any new emails?", "read the one from Mum" | Email, read-only (Gmail, iCloud, Yahoo, Fastmail with an app password). Never sends, deletes or marks anything. |
| "What's the news?", "tech news" | Free BBC headlines, no setup. The top three are also in your morning briefing. |
| "Take a note: …", "what did I note about …?" | Notes, listed on the Reminders page. |
| "Summarise what I copied" | Reads your clipboard, only when you type the request on the PC. |
| (automatic) | A pop-up and spoken warning when rain is likely in the next couple of hours. |
| "Search the web for …", "research …" | Free web search through your own SearXNG, or a Brave key (Settings → Web search). |

Plus:
- Replies are formatted properly: bold text, headings and lists instead of `**` and `##`.
- A **Skills** page lists everything, with phrases you can click.
- A **Get ULTRON ready** checklist on Home walks a new setup through.

## Safety
- An independent review of tonight's code found six issues, all fixed (details in SECURITY.md).
- The main one: once ULTRON has read anything from outside in a reply (an email, a web page, a file, the calendar, the
  clipboard), any action in that reply now waits for your approval. A planted "turn off the lights" in an email can't
  act by itself.

## Checks
- 272 automated tests and 57 browser steps pass locally.
- The online checks (Windows and Linux, with the real local AI model) run on every change.

## Ideas for next time
- Better turn-taking: a sense of when you've *finished* talking, not just the trailing-off words.
- Spotify and app-specific controls; more smart-home phrases (colours, "movie mode").
- Outlook email (needs Microsoft sign-in, which is a bigger job).
