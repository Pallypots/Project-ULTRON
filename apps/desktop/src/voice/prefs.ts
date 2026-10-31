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
  /** Hands-free: talking over ULTRON (loudly enough) stops it and takes what you say as the reply. */
  bargeIn: boolean;
  /** Spoken replies get the "Ultron" colour: a little deeper, faintly metallic. */
  ultronEffect: boolean;
}
const KEY = "ultron.voice";
const DEFAULTS: VoicePrefs = { micId: "", autoSend: true, speakMode: "voice", browserVoice: "", conversation: true, bargeIn: false, ultronEffect: false };

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
