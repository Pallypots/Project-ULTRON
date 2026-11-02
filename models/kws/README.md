# Wake-word model

A 3.3M-parameter streaming Zipformer keyword spotter trained on GigaSpeech (Apache License 2.0), int8 version, from the
sherpa-onnx project's `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` release. Files were renamed only.
It listens for the wake name(s) set in ULTRON's personality ("Ultron" by default) in each hands-free phrase, so full
speech recognition runs only when you actually said the name. Runs on this PC, offline.
