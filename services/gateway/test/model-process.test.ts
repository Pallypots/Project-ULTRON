import { describe, expect, it } from "vitest";
import { ModelProcess } from "../src/models/process.ts";

describe("model host process (speech models run outside the service)", () => {
  it("answers requests, survives a crash by restarting, and restarts a stuck model", async () => {
    const p = new ModelProcess("test model");
    const crashes: string[] = [];
    p.onCrash = (why) => crashes.push(why);
    try {
      // Positive control: a request reaches the host and a real answer (here, an error message) comes back.
      await expect(p.request({ kind: "stt.run", samples: new Float32Array(16000) }, 30_000)).rejects.toThrow(/not loaded/);
      const first = p.pid;
      expect(first).toBeGreaterThan(0);
      // Negative control: kill it from outside, as if the model crashed or ran out of memory. The crash is noticed…
      process.kill(first!, "SIGKILL");
      await new Promise((r) => setTimeout(r, 300));
      expect(crashes.length).toBe(1);
      // …and the next request simply starts a fresh process.
      await expect(p.request({ kind: "stt.run", samples: new Float32Array(10) }, 30_000)).rejects.toThrow(/not loaded/);
      expect(p.pid).not.toBe(first);
      // The service's own event loop kept running the whole time (this test's timers fired on schedule).
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      expect(Date.now() - t0).toBeLessThan(500);
    } finally {
      p.stop();
    }
  }, 60_000);

  it("gives up on a request that takes too long and restarts the model", async () => {
    const p = new ModelProcess("slow model");
    try {
      // A load that can't finish in 1 ms (the host has to start first).
      await expect(p.request({ kind: "stt.load", model: "x", cacheDir: "/nonexistent" }, 1)).rejects.toThrow(/took too long/);
      expect(p.pid).toBeNull(); // killed, not left blocking
    } finally {
      p.stop();
    }
  }, 30_000);
});
