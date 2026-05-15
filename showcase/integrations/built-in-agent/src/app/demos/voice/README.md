# Voice (built-in-agent)

Speech-to-text via `@copilotkit/voice`'s `TranscriptionServiceOpenAI`. The
V2 runtime advertises `audioFileTranscriptionEnabled: true` so CopilotChat
renders a mic button; a "Play sample" button fetches a bundled WAV and
exercises the same `/transcribe` endpoint without microphone permissions.

- Dedicated route: `/api/copilotkit-voice/[[...slug]]`
- `useSingleEndpoint={false}` so transcribe is mounted at `/transcribe`
- Sample asset: `/public/demo-audio/sample.wav`
- Key files: `page.tsx`, `sample-audio-button.tsx`,
  `../../api/copilotkit-voice/[[...slug]]/route.ts`
