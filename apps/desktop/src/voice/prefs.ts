// Per-device voice preferences (which microphone, whether to send right after speaking).
export interface VoicePrefs {
  micId: string;
  autoSend: boolean;
  /** When ULTRON reads replies aloud: after I talk to it, always, or never. */
  speakMode: "voice" | "always" | "never";
  /** Chosen built-in system voice (when the "browser" engine is used). */
  browserVoice: string;
  /** Conversation mode: after ULTRON answers a hands-free request, keep listening for a reply without the wake word. */
  conversation: boolean;
}
const KEY = "ultron.voice";
const DEFAULTS: VoicePrefs = { micId: "", autoSend: true, speakMode: "voice", browserVoice: "", conversation: true };

export function loadVoicePrefs(): VoicePrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VoicePrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveVoicePrefs(p: VoicePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}
