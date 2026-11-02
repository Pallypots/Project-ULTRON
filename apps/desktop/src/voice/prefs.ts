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
  /** The Ultron voice effect while in Council mode (on by default: it's his face-to-face voice). */
  councilEffect: boolean;
  /** Settings version: 2 switched interrupt-by-voice on once for everyone (it's safe now, with the echo guard). */
  v?: number;
}
const KEY = "ultron.voice";
const DEFAULTS: VoicePrefs = { micId: "", autoSend: true, speakMode: "voice", browserVoice: "", conversation: true, bargeIn: true, ultronEffect: false, councilEffect: true, v: 2 };

export function loadVoicePrefs(): VoicePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VoicePrefs>;
    // One-time upgrade: interrupt-by-voice was experimental and off; it's on by default now. Turning it off again sticks.
    if ((saved.v ?? 1) < 2) Object.assign(saved, { bargeIn: true, v: 2 });
    return { ...DEFAULTS, ...saved };
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
