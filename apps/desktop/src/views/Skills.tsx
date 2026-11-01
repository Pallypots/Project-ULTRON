/** "What can I say?": everything ULTRON can do, with phrases to click and try. */
const SKILLS: { title: string; icon: string; say: string[]; note?: string }[] = [
  { title: "Just talk", icon: "◉", say: ["council mode", "Tell me a joke", "What do you think about AI?", "Catch me up"], note: "Council mode is face to face, with an open microphone. Say \"that's all\" to finish." },
  { title: "Your day", icon: "☀", say: ["Good morning, brief me", "What's the news?", "What's on my calendar today?", "What's the weather?", "Any new emails?"] },
  { title: "Reminders, to-dos and notes", icon: "⏰", say: ["Remind me in 20 minutes to check the oven", "Add milk and eggs to my list", "What's on my list?", "Take a note: the spare key is under the blue pot", "Read my notes"] },
  { title: "Smart home", icon: "💡", say: ["Lights off", "Make the lights red", "Dim the lights to 20%", "Set the heating to 21", "Which lights are on?"], note: "Needs Home Assistant (Connections → Smart home)." },
  { title: "Your PC", icon: "🖥", say: ["Pause the music", "Turn it up a bit", "Open notepad", "How's my PC doing?", "Look at my screen and tell me what you see", "Lock my PC"] },
  { title: "Knowledge and research", icon: "🔎", say: ["Research how solid-state batteries work", "Search the web for today's tech news", "Who was Ada Lovelace?", "Define serendipity", "What time is it in Tokyo?"] },
  { title: "Quick maths and conversions", icon: "🧮", say: ["What's 15% of 84.50?", "Convert 5 miles to km", "$50 in euros", "How many cups in a litre?"] },
  { title: "Your stuff", icon: "📁", say: ["Summarise what I copied", "Pull up my CV", "What did we talk about yesterday?", "What do you know about me?"], note: "Files only from folders you approved (Files page)." },
  { title: "Keep an eye on things", icon: "👁", say: ["Tell me when example.com/deal says in stock", "What pages are you watching?"] },
  { title: "Routines", icon: "⚡", say: ["Good night"], note: "Make your own in Settings → Routines: one phrase, several steps." },
  { title: "Memory", icon: "▣", say: ["Remember that my sister's birthday is March 3rd", "Forget my sister's birthday"], note: "Everything ULTRON remembers is in the Memory Vault, where you can edit or delete it." },
  { title: "Change ULTRON", icon: "⚙", say: ["Switch your brain to local", "Think hard about whether I should lease or buy a car"], note: "Personality, voice and wake word are in Settings." },
];

export function SkillsView({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <div className="skills">
      <h1>What can I say?</h1>
      <p className="muted">Click any phrase to try it, or just say it: "Ultron, …" in hands-free, or anything in Council mode.</p>
      <div className="skills__grid">
        {SKILLS.map((s) => (
          <section key={s.title} className="hud-panel" aria-labelledby={`sk-${s.title}`}>
            <h2 className="hud-panel__title" id={`sk-${s.title}`}><span>{s.icon} {s.title.toUpperCase()}</span></h2>
            <div className="chips">
              {s.say.map((q) => (
                <button key={q} className="chip" onClick={() => onAsk(q)}>“{q}”</button>
              ))}
            </div>
            {s.note && <p className="small muted" style={{ margin: "10px 0 0" }}>{s.note}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
