# Sprint report: "make it smarter, give it a personality, make it red" (Oct 30–31, 2026)

You asked for a red MCU-style Ultron with a real personality that jokes, talks and catches up with you, and for every sprint to make it
smarter. ULTRON went from **v0.11 to v0.13**. Everything is pushed to **github.com/Pallypots/Project-ULTRON** and passes the automatic checks
on GitHub's Windows and Linux machines.

## What's new

**Looks**
- **Red interface** (and a red icon), inspired by the films' Ultron. A local brain shows full red. When you switch brains, the accent color
  changes: amber for cloud, violet for the test brain.

**Personality**
- ULTRON now has a character: witty, a bit theatrical, warm, and on your side. It jokes back, has opinions, and asks about your projects
  and plans (one question at a time, not an interrogation). It drops the jokes when you're stressed or in a hurry.
- **It speaks first.** When you open the app, the Home screen shows a line from ULTRON that catches up with you. It knows:
  - when you last talked, and what about;
  - what you've told it recently;
  - what's coming up: to-dos due soon and today's reminders.
- When you talk to it by voice, it answers in a spoken style, with no bullet lists read aloud.
- Settings → Personality → **Character**: rewrite how it talks in plain English. **Home city** is set there too, for the weather.

**Smarter**
- **Offers to remember things.** Say "my sister's birthday is March 3" and it offers to save that. Nothing is stored until you click **Approve**.
- **Remembers past conversations:** "what did we say about the Oogie release?" searches your earlier chats, which stay on this PC.
  If you delete a conversation, ULTRON can't recall it any more.
- **To-do list:**
  - "add milk and eggs to my list", "what's on my list?";
  - "I paid the electric bill" ticks it off, and it asks which one if more than one item matches;
  - also on the Reminders page, and in your morning briefing.
- **New abilities:**
  - an exact calculator;
  - Wikipedia look-ups;
  - weather plus a 3-day forecast (also in the briefing);
  - reading and summarizing a web page you paste.
- **Instant commands:** "open github.com", "add … to my list", "what's on my list?", "what's the weather?" and "what's 15% of 80?" are now
  answered in under a second, even when the local brain would need a minute.

**More trustworthy**
- **Honesty check.** In testing, the small local brain once *said* "approval requested" without actually requesting anything. ULTRON now
  catches replies like that and adds a visible correction, and the slip is also recorded in the Activity log. This was confirmed with the
  real model on GitHub's machines.
- Small local brains are now given only the tools that fit your message. That makes them more reliable and faster.
- ULTRON never reads pages on your own computer or home network, and it asks before reading a link you didn't give it.

## Proof
| Check | Result |
|---|---|
| Automated tests | **191 passed**, plus real-model and real-service tests on CI (all green on Windows + Linux) |
| Browser end-to-end test (Windows + Linux) | **41 steps** pass, including the greeting, the memory offer and the to-do list |
| Live Wikipedia (CI) | "Ada Lovelace … English mathematician …" |
| Live weather (CI) | Boston: 54°F, clear sky, 3-day forecast |
| Reading a real web page (CI) | example.com: "Example Domain" |
| Real local brain (gemma4:e2b, CI) | "Paris is the capital of France." When it claimed an action it never took, the honesty check corrected it |
| Real local brain personality (CI), asked "I'm back, tell me a joke" | *"Well, well, look who has returned from the mortal coil! I was beginning to suspect you'd been abducted by an inferior sentient being… Why did the scarecrow win an award? Because he was outstanding in his field!"* |
| Real local brain, word problem "a $1299 laptop with 15% off plus $4.99 shipping" (CI) | chose the calculator by itself, **correct: $1,109.14**, then asked: *"What are you planning to do with this new piece of hardware? Are we dominating the digital landscape, or just browsing cat videos?"* |
| Personality tuning | the small brain overdid the villain ("your fragile organic shell"); the character now teases affectionately and never belittles you. After the change: *"Look who has returned from the void… Here's one for your weary circuits…"* |
| Bug found by that CI run | "What is 1299 times 0.85, plus 4.99?" failed on the comma; **fixed**, and maths ULTRON can't parse now goes to the brain |

## Try it (10 minutes)
1. Update: on GitHub, **Code → Download ZIP**, extract it over your folder, then run **Start-ULTRON.bat**.
2. Settings → Personality → set your **Home city**. Click Save.
3. Go back to Home and read what ULTRON says to you. Press 🔊 to hear it.
4. Try: "my sister's birthday is March 3" (then Approve) · "add milk and eggs to my list" · "what's the weather?" · "tell me a joke" ·
   "what's 18% of 64.50?" · "what did we talk about yesterday?"

## Honest limitations
- Jokes and warmth depend on the brain. The small local brain is less witty and slower (40–90 s per answer on CPU-only machines) than a
  bigger local model or a cloud brain. A PC with a graphics card should be much faster.
- Instant commands only catch clearly worded requests. Everything else goes to the brain.
- There's no general web search yet. Wikipedia, weather and links you paste work. A full search engine needs a search service account,
  which I can add if you want it.
- The greeting doesn't speak by itself (browsers block sound until you click something). Press 🔊 on it to hear it.
