# Voice (AG2)

Speech-to-text transcription via `@copilotkit/voice` and OpenAI Whisper, with
a sample-audio button that bypasses the microphone for Playwright / demo use.

## Files

- `page.tsx` — `<CopilotChat>` plus a sample-audio button that POSTs a
  bundled clip to the runtime's `/transcribe` endpoint.
- `sample-audio-button.tsx` — fetches `/demo-audio/sample.wav` and submits it
  as multipart/form-data.
- `../../api/copilotkit-voice/[[...slug]]/route.ts` — V2 runtime with a
  `TranscriptionServiceOpenAI` and a guard that returns a 401 when
  `OPENAI_API_KEY` is missing.

## Notes

The route uses the V2 `CopilotRuntime` directly because the V1 wrapper drops
`transcriptionService`. `audioFileTranscriptionEnabled: true` is advertised
by the V2 runtime's `/info` response when the service is wired, which makes
`<CopilotChat>` render the mic button automatically.
