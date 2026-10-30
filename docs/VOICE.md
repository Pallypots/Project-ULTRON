# Voice

## What ships in v0.2 (UL-008)
**Push-to-talk → text.** In Chat:
- **Hold** the 🎙 Talk button, or hold **Space** (when not typing), while speaking. Release to send.
- **Click** once for hands-free; click again to send. **Esc** cancels and discards.
- A red **Listening** bar with a timer and level meter is always visible while the mic is open, and the HUD core reacts to your voice level.
- Settings → Voice: engine, model download, microphone picker (follows plugged/unplugged devices), mic test meter, and "send right after I stop talking" or review-first.

**Pipeline:** browser `getUserMedia` (echo cancellation, noise suppression, auto gain) → AudioWorklet captures PCM → resample to 16 kHz mono → WAV →
`POST /api/voice/transcribe` → engine → text → normal chat message saved with `inputMode: "voice"`.
The microphone is opened only for a recording and all tracks are stopped immediately after. Audio is held in memory only, never written to disk.
The audit log records engine, duration and character count, never audio or words.

## Speech-to-text engines
| Engine | Privacy | Cost | Setup | Verified |
|---|---|---|---|---|
| **Local Whisper** (default, `Xenova/whisper-base.en` via transformers.js / ONNX Runtime) | Audio never leaves the PC | Free | One-time model download (~150–300 MB) from Hugging Face, cached in `<data>/models` | Real-model test runs in CI on Windows + Linux with the JFK sample. (Hugging Face is blocked from the dev container, so it can't be run there.) |
| OpenAI transcription | Audio sent to OpenAI | Per-minute API pricing | OpenAI key + model name | Built; **not tested with a live key** |
| Test engine | Local, no recognition | Free | none | Unit + browser tests |

`Xenova/whisper-small.en` is more accurate but roughly 3× slower. You can switch in Settings with no code changes.

## Voice transport: LiveKit vs direct provider realtime (blueprint Phase 2 comparison)
Push-to-talk needs no realtime transport: one HTTP upload per utterance is simpler, works offline with local Whisper, and is easy to test.
The comparison matters for **UL-009** (streaming spoken replies, barge-in):

| | LiveKit Agents (self-hosted) | Direct provider realtime (e.g. OpenAI Realtime over WebRTC) |
|---|---|---|
| What runs on the PC | LiveKit server (Go binary) + agent worker (Python/Node) + our gateway | Our gateway only (mints short-lived session tokens); the browser connects to the provider |
| Interruptions / turn detection | Built-in VAD, turn detector, barge-in handling | Built into the provider's realtime session |
| Provider lock-in | Low: mix any STT / LLM / TTS, including local Whisper/Piper | High: one vendor does STT+LLM+TTS together |
| Fits ULTRON's memory/persona/policy core | Agent calls our gateway, so it fits naturally | The provider's model answers directly; our memory and tools must be wired in as provider tools |
| Offline / private option | Yes (local STT/TTS) | No |
| Owner setup burden on Windows | Higher: extra services to run | Low |
| Latency (expected, **not yet measured**) | Depends on chosen STT/TTS; typically sub-second with streaming components | Typically lowest, single hop |

**Interim decision (D-012), implemented in v0.4:** keep push-to-talk on HTTP. For UL-009, use **spoken replies with the gateway streaming TTS audio over the existing connection**,
with barge-in implemented client-side (stop playback the moment the mic opens). Adopt LiveKit only if measured latency or interruption reliability on the owner's
hardware falls short. The blueprint asks for a written benchmark on actual hardware: time to first spoken audio and interruption reliability.
That needs the owner's PC and is listed as an open item, not claimed.

## Spoken replies (v0.4, UL-009)
- **Engine:** Kokoro-82M (Apache-2.0) via `kokoro-js`, sharing ULTRON's transformers.js/ONNX Runtime (npm `overrides` dedupes it, so there's no second
  500 MB runtime). Model `onnx-community/Kokoro-82M-v1.0-ONNX` (fp16, ~165 MB) downloads once into `<data>/models`; voices ship with the package.
- **Streaming:** the UI splits the reply into sentences as tokens arrive (`SentenceSplitter`) and requests `POST /api/voice/speak` per sentence. The next
  sentence is generated while the current one plays.
- **Barge-in:** opening the mic (Talk / Space), Esc, Stop, or sending a new message stops playback and aborts pending generations. The mic is
  never open while ULTRON speaks unless the owner opens it, so there's no echo loop.
- **Fallback:** Windows built-in voices via `speechSynthesis`, restricted to `localService` voices (online "natural" voices are hidden for privacy).
- **Privacy:** speech audio is generated in memory and never stored.

## Hands-free (v0.7)
Energy VAD in the browser (20 ms frames, adaptive noise floor, 60 ms to start, 700 ms of quiet to end, 10 s max, 0.4 s min) → WAV →
`POST /api/voice/transcribe?mode=wake` → local Whisper → `matchWake()` → `{addressed:false}` (dropped) or the command text. See D-018.

### Kokoro precision benchmark (CI, 2026-10-30)
Real-time factor (generation time ÷ audio length; below 1 = faster than speaking), same sentence, all intelligible to Whisper:

| Precision | Windows (GitHub runner) | Linux (GitHub runner) |
|---|---|---|
| q8 | 1.98 | 1.38 |
| fp32 | 0.86 | 0.79 |
| **fp16 (default)** | **0.87** | **0.77** |
| q4 | 1.58 | 0.77 |

The 8-bit model is the smallest download but the slowest on CPU, so fp16 is the default (half of fp32's size, same speed).
Override with `ULTRON_KOKORO_DTYPE`. The owner's PC will differ; measure there.

## Not done yet
- Voice barge-in during hands-free (currently Esc/Talk interrupt).
- Streaming partial transcripts while speaking (current flow transcribes after release).
- Benchmarks on the owner's hardware.
