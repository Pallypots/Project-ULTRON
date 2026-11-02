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

## The app's own responsiveness (input lag), 2026-11-01
Everything in the app window shares one thread, the browser's main thread. If something hogs it, clicks and typing
wait. Measured in a test browser with a long-task monitor; a deliberate 200 ms freeze served as the positive control
and was always caught.

| Situation | Before | After |
|---|---|---|
| Council mode: tasks over 50 ms in 5 s | 88 (each ~55 ms), 15 fps, clicks waited 62–97 ms | **0**, ~60 fps, clicks within 2–24 ms |
| Chat with hands-free on: redraws of the whole chat in 4 s | **171** (the mic level was React state, updated 50×/s) | **6–12** |

Causes and fixes:
- **The face drew its wireframe twice** (a leftover loop), each time with an extra glow pass, plus a full-screen glow
  fill and a pixel readback for the glitch effect every frame. Now: one pass, glow painted once by CSS, no readback,
  30 fps cap, paused while hidden, and the drawing surface capped at about 1.6 MP. A CSS blur filter on the canvas was
  also measured and dropped: 15 fps without a GPU.
- **Microphone and voice levels** were stored in React state 50–60 times a second, re-rendering the whole chat. They're
  now read live by the meters, the core and the face (`apps/desktop/src/voice/live.tsx`), with no re-render.
- The push-to-talk timer re-rendered every frame; it now updates once a second.

A regression test (the browser test's "Responsiveness" step) enforces a budget with the positive control: under 400 ms
of input blocking per 4 s in chat with hands-free, under 600 ms in Council, and at most 40 chat redraws per 4 s. The
old code fails it (171 redraws).

## Night of 2026-11-02: speech, voice, brain and the service (measured in CI)
All on GitHub's free runners (4 CPU threads, no GPU), so the owner's PC will differ; the comparisons hold.

| What | Before | After | How it was measured |
|---|---|---|---|
| Understanding a 2–3 s phrase | Whisper base.en ~2.5 s | **Moonshine tiny ~0.13–0.27 s**, same accuracy (0 errors on 11 clips incl. a 44 s message) | `stt-ab.real.test.ts`, word error rate, same audio for every model |
| Hands-free "what time is it?" end to end (in the trace) | recognised in 1.2–2.6 s, then the brain | recognised in 0.2 s, **answered instantly** by code | `handsfree-trace.real.test.ts` |
| Phrases without "Ultron" (TV, room) | full recognition every phrase | wake-word detector, ~60–110 ms per phrase; 19/20 "Ultron" caught in 4 voices, 0/20 false alarms | `kws.real.test.ts` |
| Everyday commands without the brain | 27/40 | **39/40** (open-ended questions: 20/20 still reach the brain) | `instant.test.ts` |
| Second reply in a conversation (brain reading) | ~14 s (re-read context) | **1.7–2.8 s** vs 13–39 s from scratch | `ollama.real.test.ts` with a cold control |
| Status check with 4,000 conversations / 3,000 memories | 29 ms of the service's thread | **1 ms** | `status-load.test.ts` |
| Voice: short opener ("Right away.") | fp16 / fp32 / q4 all ~0.3 s (Linux), ~0.6 s (Windows); q8 ~2× slower | kept fp16 (smaller); medians of 5 interleaved rounds, run alone | `tts-bench.real.test.ts` |

**Local brain candidates** (`brain-ab.real.test.ts`, six everyday requests through ULTRON's real pipeline):
the same core tools with every message beat tools chosen per message on both models tried
(gemma4:e2b 4/6 vs 3/6, first word 2.5 s vs 4.2 s; qwen3:1.7b 6/6 vs 5/6, 2.0 s vs 3.5 s), so that is now the default.
Bigger models (llama3.2:3b, granite4:micro) were more accurate but ~33 s to the first word on this CPU.

**Smart Turn v3** (end-of-turn from intonation) was wired up and measured, but synthetic speech can't evaluate it: the
on-PC voice makes cut-off phrases sound finished. It is not used to decide when to answer until it's tried on real
recordings (`turn.real.test.ts`).

**Measurement lessons:** single samples misled twice (the voice precision order flipped between runs; tests running in
parallel slowed each other). Benchmarks now run in their own CI step, interleave the candidates, and report medians.
