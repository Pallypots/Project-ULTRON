import { SileroVad, type OrtLike } from "@ultron/audio";

let loading: Promise<SileroVad | null> | null = null;

/**
 * The Silero speech detector for hands-free listening, loaded once from ULTRON itself (/vendor, never the internet).
 * Resolves to null if it can't load (old browser, files missing); hands-free then falls back to loudness.
 */
export function loadVad(): Promise<SileroVad | null> {
  loading ??= (async () => {
    try {
      const url = "/vendor/ort/ort.wasm.min.mjs";
      const ort = (await import(/* @vite-ignore */ url)) as OrtLike & { env: { wasm: { wasmPaths: string; numThreads: number } } };
      ort.env.wasm.wasmPaths = "/vendor/ort/";
      ort.env.wasm.numThreads = 1; // one small model; threads would need cross-origin isolation and buy nothing here
      const res = await fetch("/vendor/silero_vad_v6.onnx");
      if (!res.ok) throw new Error(`speech detector model: HTTP ${res.status}`);
      const vad = await SileroVad.load(ort, new Uint8Array(await res.arrayBuffer()), { executionProviders: ["wasm"] });
      (window as unknown as { __ultronVad?: string }).__ultronVad = "silero";
      return vad;
    } catch (err) {
      console.warn("ULTRON: speech detector unavailable, using loudness instead:", err);
      (window as unknown as { __ultronVad?: string }).__ultronVad = "rms";
      loading = null; // try again next time hands-free starts
      return null;
    }
  })();
  return loading;
}
