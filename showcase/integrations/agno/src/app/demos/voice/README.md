# Voice Input

## What This Demo Shows

A V2 runtime with a `transcriptionService` wired in advertises
`audioFileTranscriptionEnabled: true` on `/info`, which makes
`<CopilotChat />` render a microphone button. Click → speak → click
again, and the recorded audio is POSTed to `/transcribe`, transcribed
via OpenAI's Whisper, and dropped into the chat composer.

A "Play sample" button below the chat fetches a bundled `.wav` and
drives the same `/transcribe` endpoint so screenshot and Playwright runs
work without microphone permissions.

## Technical Details

- Runtime: `src/app/api/copilotkit-voice/[[...slug]]/route.ts` — V2
  runtime via `createCopilotRuntimeHandler`.
- Transcription: `GuardedOpenAITranscriptionService` returns a clean
  401 when `OPENAI_API_KEY` is missing.
- Agent: the Agno main agent at `/agui` (no special agent needed for
  voice — the transcription path is purely runtime-side).
