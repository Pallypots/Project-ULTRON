import OpenAI, { toFile } from "openai";
import { SttError, type SttEngine, type SttStatus } from "./types.ts";

/** OpenAI's hosted transcription. Needs an OpenAI API key; the model name is the owner's choice. */
export class OpenAISttEngine implements SttEngine {
  readonly id = "openai";
  readonly privacy = "Speech audio is sent to OpenAI for transcription.";
  private client: OpenAI | null;

  constructor(
    apiKey: string | undefined,
    readonly model: string,
    baseUrl?: string,
  ) {
    this.client = apiKey ? new OpenAI({ apiKey, baseURL: baseUrl || undefined, maxRetries: 1 }) : null;
  }

  status(): SttStatus {
    if (!this.client) return { state: "not_configured", detail: "Add an OpenAI API key in Settings → Language model to use OpenAI speech recognition." };
    if (!this.model) return { state: "not_configured", detail: "Enter the OpenAI transcription model name in Settings → Voice." };
    return { state: "ready", detail: `OpenAI ${this.model}` };
  }

  async prepare(): Promise<void> {}

  async transcribe(_samples: Float32Array, wav: Uint8Array): Promise<string> {
    const st = this.status();
    if (st.state !== "ready" || !this.client) throw new SttError(st.detail, "not_configured");
    try {
      const res = await this.client.audio.transcriptions.create({ file: await toFile(wav, "speech.wav", { type: "audio/wav" }), model: this.model });
      return res.text.trim();
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError) throw new SttError("OpenAI rejected the API key.", "not_configured");
      if (err instanceof OpenAI.APIConnectionError) throw new SttError("Couldn't reach OpenAI. Check your internet connection.", "unavailable");
      if (err instanceof OpenAI.APIError) throw new SttError(`OpenAI transcription error: ${err.message}`, "failed");
      throw err;
    }
  }
}
