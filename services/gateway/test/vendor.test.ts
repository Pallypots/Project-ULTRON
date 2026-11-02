import { describe, expect, it } from "vitest";
import { startGateway } from "./helpers.ts";

describe("files for the app's speech detector are served from this PC", () => {
  it("serves the runtime and model with the right types; nothing else is reachable through it", async () => {
    const g = await startGateway();
    try {
      const get = (url: string) => g.gw.app.inject({ method: "GET", url, headers: { host: "localhost:7477" } });
      const wasm = await get("/vendor/ort/ort-wasm-simd-threaded.wasm");
      expect(wasm.statusCode).toBe(200);
      expect(wasm.headers["content-type"]).toMatch(/application\/wasm/);
      expect(wasm.rawPayload.subarray(0, 4).toString("hex")).toBe("0061736d"); // "\0asm"
      expect((await get("/vendor/ort/ort.wasm.min.mjs")).headers["content-type"]).toMatch(/javascript/);
      const model = await get("/vendor/silero_vad_v6.onnx");
      expect(model.statusCode).toBe(200);
      expect(model.rawPayload.length).toBeGreaterThan(1_000_000);
      // Negative controls: only the named files, no wandering around the disk.
      for (const bad of ["/vendor/../package.json", "/vendor/%2e%2e/package.json", "/vendor/ort/../../../.env", "/vendor/ort/ort.node.min.js", "/vendor/"])
        expect((await get(bad)).statusCode, bad).not.toBe(200);
    } finally {
      await g.close();
    }
  });
});
