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

---

# Sprint 2: "just talk to him" (v0.14 → v0.15)

You asked to be able to simply speak to ULTRON and have real conversations, and for it to keep getting smarter.
(One honest line: no one can make software truly conscious today, and ULTRON is built never to pretend it is. What I *can* do is make it
listen, remember, reflect and follow up like a good companion, which is what this sprint is about.)

## What's new
- **🎙 Talk to ULTRON** (Home): one click and it's listening. No button to hold, no "Ultron" needed for the first sentence.
- **Conversation mode:** after it answers, it keeps listening for about 10 seconds, so you just reply, back and forth like a normal
  conversation. Say "that's all" or "goodbye" to wrap up. (Settings → Voice to turn it off.)
- **No awkward silences:** if the brain is slow to start answering, ULTRON says "Hmm, let me think." while it works.
- **Reflects on your conversations:** when a chat has been quiet for half an hour, ULTRON writes itself a short note about it, so later it can
  say "yesterday you were fixing the audio crackle…". Hover over a conversation in Chat to see its note.
- **Deep thinking on request:** "think hard about…", "take your time" or "step by step" makes it reason carefully first (slower, smarter).
- **"What do you know about me?"** now goes through everything you've had it remember.

## Proof (real local brain on GitHub's Linux machines)
| Check | Result |
|---|---|
| Conversation note written by the local brain | *"The owner asked for the capital of France and requested an action to open a specific website. The owner is curious about the system's ability to execute external commands."* |
| Shopping maths, in character | used the calculator, **$1,109.14** correct, then: *"That should keep your wallet happy. Are you looking at a specific model, or is this a grand conquest of the digital realm?"* |
| Browser test with a simulated microphone | **43 steps** pass on Windows and Linux, including conversation mode and Talk to ULTRON |
| Automated tests | **198 passed** |

## Try it
1. Make sure speech is set up (Settings → Voice: **Download speech model now**; Spoken replies: **Download voice now**).
2. Home → **🎙 Talk to ULTRON**, and just talk. Reply when it answers. Say "that's all" when you're done.
3. Try: "think hard about whether I should learn Rust or Go next" · "what do you know about me?"

## Honest limitations
- Conversations feel best with a fast brain. On a CPU-only PC the small local model takes a long time per answer; a graphics card
  (or a bigger local model on a strong GPU) makes a huge difference.
- You can interrupt ULTRON while it's talking with the Talk button, Esc or Stop, but not by voice alone yet in hands-free mode.
- It can't hear you while it's speaking (by design, so it doesn't answer itself).
