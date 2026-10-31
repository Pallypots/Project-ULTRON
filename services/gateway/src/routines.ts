import { z } from "zod";
import type { PreferenceStore } from "@ultron/memory";

/** One phrase → several instant commands, run in order (e.g. "good night" → pause music, tomorrow's calendar, my list). */
export const Routine = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(40),
  phrases: z.array(z.string().trim().min(2).max(60)).min(1).max(5),
  steps: z.array(z.string().trim().min(2).max(200)).min(1).max(10),
  enabled: z.boolean().default(true),
});
export type Routine = z.infer<typeof Routine>;

export const ROUTINE_EXAMPLES: Omit<Routine, "id">[] = [
  { name: "Good night", phrases: ["good night", "goodnight", "i'm going to bed"], steps: ["pause the music", "what's on my calendar tomorrow", "what's on my list"], enabled: true },
  { name: "Work mode", phrases: ["work mode", "let's get to work"], steps: ["pause the music", "open visual studio code", "what's on my calendar today"], enabled: true },
  { name: "I'm home", phrases: ["i'm home", "i am home"], steps: ["what's the weather", "what's on my list"], enabled: true },
];

const norm = (s: string) => s.toLowerCase().replace(/^\s*(?:(?:hey|ok|okay)\s+)?(?:ultron[\s,:!.-]+)?/, "").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();

export function loadRoutines(prefs: PreferenceStore): Routine[] {
  return prefs.get<Routine[]>("routines", []);
}

/** The routine whose phrase is exactly what the owner said (ignoring "Ultron," and punctuation). */
export function matchRoutine(prefs: PreferenceStore, message: string): Routine | null {
  const said = norm(message);
  return loadRoutines(prefs).find((r) => r.enabled && r.phrases.some((p) => norm(p) === said)) ?? null;
}
