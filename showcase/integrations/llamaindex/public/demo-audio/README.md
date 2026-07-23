# Voice demo audio

Drop a small (<100KB) WAV file named `sample.wav` in this directory. The voice
demo (`/demos/voice`) fetches it client-side and POSTs to the transcription
endpoint so the flow works without mic permissions.

Expected content: an audio clip speaking the phrase
**"What is the weather in Tokyo?"** — the demo caption advertises that phrase
to the user, and the bundled QA checklist + E2E spec assert the transcribed
text contains "weather" and/or "Tokyo".

Generate locally, for example:

- macOS: `say -o sample.aiff "What is the weather in Tokyo?" && ffmpeg -i sample.aiff -ar 16000 -ac 1 sample.wav`
- Linux: `espeak-ng -w sample.wav "What is the weather in Tokyo?"`
- Windows: PowerShell `System.Speech.Synthesis.SpeechSynthesizer` → `SetOutputToWaveFile`

Target: 16kHz mono, 3-5s duration, <100KB.
