import { speak as fetchSpeech } from "../api.ts";
import { loadVoicePrefs } from "./prefs.ts";

export type SpeakMode = "voice" | "always" | "never";
export type TtsEngineId = "local" | "browser" | "mock";

/**
 * Plays ULTRON's replies sentence by sentence. The next sentence is generated while the current one plays,
 * and stop() silences everything immediately (barge-in, Stop button, new message).
 */
/** Set while Council mode is open (its own voice-effect preference applies). */
export const voiceMode = { council: false };

export class Speaker {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private queue: Promise<AudioBuffer | null>[] = [];
  private current: AudioBufferSourceNode | null = null;
  private aborts = new Set<AbortController>();
  private playing = false;
  private generation = 0;
  private buf = new Float32Array(1024);
  onChange: (speaking: boolean) => void = () => {};
  /** Called the moment audio actually starts coming out of the speakers (for measuring response time). */
  onSound: () => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(
    private engine: () => TtsEngineId,
    private browserVoice: () => string,
    private speed: () => number,
  ) {}

  get speaking() {
    return this.playing;
  }

  /** Call from a user gesture (send / push-to-talk) so the browser allows audio playback. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  enqueue(sentences: string[]) {
    for (const s of sentences) {
      if (!s.trim()) continue;
      if (this.engine() === "browser") this.speakBrowser(s);
      else this.queue.push(this.fetchAudio(s, this.generation));
    }
    if (this.engine() !== "browser") this.pump();
  }

  private async fetchAudio(text: string, gen: number): Promise<AudioBuffer | null> {
    const ctl = new AbortController();
    this.aborts.add(ctl);
    try {
      const wav = await fetchSpeech(text, ctl.signal);
      if (!wav || gen !== this.generation) return null;
      this.unlock();
      return await this.ctx!.decodeAudioData(wav);
    } catch (err) {
      if ((err as Error).name !== "AbortError" && gen === this.generation) this.onError((err as Error).message);
      return null;
    } finally {
      this.aborts.delete(ctl);
    }
  }

  private async pump() {
    if (this.playing) return;
    const gen = this.generation;
    while (this.queue.length && gen === this.generation) {
      const next = this.queue.shift()!;
      this.setPlaying(true);
      const buffer = await next;
      if (!buffer || gen !== this.generation) continue;
      await new Promise<void>((resolve) => {
        const src = this.ctx!.createBufferSource();
        src.buffer = buffer;
        const p = loadVoicePrefs();
        if (p.ultronEffect || (voiceMode.council && p.councilEffect)) {
          src.playbackRate.value = 0.95; // a touch deeper
          src.connect(this.effectInput());
        } else src.connect(this.analyser!);
        src.onended = () => resolve();
        this.current = src;
        src.start();
        this.onSound();
      });
      this.current = null;
    }
    if (gen === this.generation) this.setPlaying(false);
  }

  private fxInput: AudioNode | null = null;

  /**
   * The optional "Ultron" voice colour: extra low end, a faint metallic ring (amplitude modulation) and a very short
   * resonant echo, mixed with the dry voice so it stays easy to understand. Built once per audio context, feeding the analyser.
   */
  private effectInput(): AudioNode {
    if (this.fxInput) return this.fxInput;
    const ctx = this.ctx!;
    const input = ctx.createBiquadFilter();
    input.type = "lowshelf";
    input.frequency.value = 220;
    input.gain.value = 5;
    const out = ctx.createGain();
    out.connect(this.analyser!);
    // Dry voice.
    const dry = ctx.createGain();
    dry.gain.value = 0.8;
    input.connect(dry).connect(out);
    // Metallic ring: the voice's loudness wobbles fast (55 Hz), which reads as "synthetic"; mixed in lightly.
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = 55;
    const depth = ctx.createGain();
    depth.gain.value = 0.9;
    osc.connect(depth).connect(ring.gain);
    osc.start();
    const ringMix = ctx.createGain();
    ringMix.gain.value = 0.28;
    input.connect(ring).connect(ringMix).connect(out);
    // Short comb echo for a hollow, "inside a suit" resonance.
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.012;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    input.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(out);
    this.fxInput = input;
    return input;
  }

  private speakBrowser(text: string) {
    if (!("speechSynthesis" in window)) return this.onError("This browser has no built-in voices.");
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => x.voiceURI === this.browserVoice());
    if (v) u.voice = v;
    u.rate = this.speed();
    u.onstart = () => {
      this.setPlaying(true);
      this.onSound();
    };
    u.onend = () => !speechSynthesis.speaking && this.setPlaying(false);
    speechSynthesis.speak(u);
  }

  /** Silence immediately and drop anything queued. */
  stop() {
    this.generation++;
    for (const c of this.aborts) c.abort();
    this.aborts.clear();
    this.queue = [];
    try {
      this.current?.stop();
    } catch {
      /* already stopped */
    }
    this.current = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.setPlaying(false);
  }

  level(): number {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const s of this.buf) sum += s * s;
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }

  private setPlaying(p: boolean) {
    if (p === this.playing) return;
    this.playing = p;
    this.onChange(p);
  }
}
