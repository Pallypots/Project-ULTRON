// Per-device voice preferences (which microphone, whether to send right after speaking).
export interface VoicePrefs {
  micId: string;
  autoSend: boolean;
}
const KEY = "ultron.voice";

export function loadVoicePrefs(): VoicePrefs {
  try {
    return { micId: "", autoSend: true, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VoicePrefs>) };
  } catch {
    return { micId: "", autoSend: true };
  }
}

export function saveVoicePrefs(p: VoicePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}
