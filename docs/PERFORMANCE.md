# Parallelism and concurrency: what actually helps (measured)

Measured on the CI machines (GitHub-hosted, 2 CPU threads) with the real on-PC models: Kokoro for the voice and
Whisper base.en for listening. The test is `services/gateway/test/concurrency.bench.real.test.ts`, run on every push
with `ULTRON_TEST_TTS=1`.

| Question | Linux | Windows | Verdict |
|---|---|---|---|
| Service responsiveness while the voice speaks 4 sentences: model **inside** the service vs **in its own process** (worst timer delay) | 3728 ms vs **38 ms** | 3943 ms vs **40 ms** | **Big win: keep models in their own processes.** A 4-second freeze is longer than the app's health check allows, which is what made ULTRON look "offline" in hands-free. |
| Concurrency (pipelining): time to the first audio, whole reply vs first sentence | 11.0 s vs **2.8 s** | 12.5 s vs **3.2 s** | **Big win: speak sentence by sentence** (ULTRON already does). |
| Parallelism: 4 sentences on 1 voice process vs 2 processes at once | 12.9 s vs 13.6 s (0.95×) | 15.7 s vs 13.1 s (1.20×) | **No reliable gain** on 2 cores: ONNX Runtime already uses all cores per model. Not adopted (it would also double the voice's memory). |
| Hearing a phrase alone vs while the voice is working | 1.9 s vs 3.5 s | 2.1 s vs 3.3 s | Separate processes do run in parallel, but they share the cores. Barge-in stops the voice anyway. A future option is to cap each model's threads so listening always has a core. |

## What this means
- **Isolation matters more than raw parallelism.** Moving the models out of the service turns multi-second freezes into
  tens of milliseconds, and a model crash no longer stops ULTRON. Measured, and verified by the end-to-end hands-free
  trace (`handsfree-trace.real.test.ts`).
- **Overlapping work (concurrency) is the latency win.** Starting to speak at the first sentence, or the first pause,
  cuts the wait about fourfold.
- **More copies of a model don't help** on a typical PC, because each one already uses every core.

## Background reading
- [Node.js: Don't block the event loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop):
  CPU-heavy JavaScript stalls every other request.
- [Worker threads vs child processes](https://nodesource.com/blog/worker-threads-nodejs-multithreading-in-javascript).
  ULTRON uses child processes for full isolation: separate memory, so a crash or out-of-memory error stays contained.
- [How many workers to create](https://dev-aditya.medium.com/how-many-worker-threads-or-child-processes-should-you-create-8cabac3d2225):
  measure rather than guess. Here, measuring showed no gain from a second voice process.
