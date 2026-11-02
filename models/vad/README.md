# Speech detector model

`silero_vad_v6.onnx` is Silero VAD v6 (MIT licence, https://github.com/snakers4/silero-vad), taken unchanged from the
`@ricky0123/vad-web` 0.0.31 package. ULTRON's app runs it locally (served at `/vendor/silero_vad_v6.onnx`) to tell
speech from background noise in hands-free mode. Nothing is downloaded at run time.
