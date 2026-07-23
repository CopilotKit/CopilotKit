# QA: Voice — Spring AI

## Prerequisites

- OPENAI_API_KEY is set on the NextJS runtime (voice transcription uses Whisper)
- Spring AI backend is up

## Test Steps

- [ ] Navigate to `/demos/voice`
- [ ] Verify the microphone button appears in the chat composer
- [ ] Click "Play sample" to inject the bundled audio
- [ ] Confirm the transcribed text appears in the composer textarea
- [ ] Press send and verify the agent responds to the transcribed text

## Expected Results

- `audioFileTranscriptionEnabled: true` is advertised by the runtime probe
- Sample audio transcribes to "What is the weather in Tokyo?"
- Agent responds with weather information from `get_weather` tool
