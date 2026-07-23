# QA: Voice Input — PydanticAI

## Prerequisites

- Demo deployed and accessible at `/demos/voice`
- Agent backend healthy (check `/api/health`)
- `OPENAI_API_KEY` set (required for Whisper transcription)
- Bundled `public/demo-audio/sample.wav` present

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/voice`
- [ ] Verify the header "Voice input" is visible
- [ ] Verify the sample-audio row is visible with caption
      `Sample: "What is the weather in Tokyo?"`
- [ ] Verify the "Play sample" button is enabled
- [ ] Verify `<CopilotChat />` renders a message composer
- [ ] Verify the mic button
      (`data-testid="copilot-start-transcribe-button"`) is visible — the
      authoritative signal that `transcriptionService` is mounted on
      `/api/copilotkit-voice`

### 2. Sample-audio path

- [ ] Click "Play sample"
- [ ] Within 2 seconds, the button text flips to "Transcribing…"
- [ ] Within 15 seconds, the chat textarea contains text matching
      "weather" or "Tokyo" (case-insensitive)
- [ ] Click send — within 30 seconds an assistant response renders

### 3. Mic path (manual)

- [ ] Click the mic button and grant permission
- [ ] Speak "Hello" and click the stop button
- [ ] Within 5 seconds, the textarea contains "hello"
      (case-insensitive)
- [ ] Click send — assistant responds

### 4. Auth-error path

- [ ] Unset `OPENAI_API_KEY` on the deployment and click "Play sample"
- [ ] Verify a 401 error surfaces (not an opaque 503) — the
      `GuardedOpenAITranscriptionService` maps missing-key to a typed
      401 via the runtime's error categorizer.

## Known Limitations vs. langgraph-python port

- None — the transcription-service wiring is framework-agnostic.

## Expected Results

- Mic affordance is visible on the PydanticAI voice route.
- Sample-audio round-trip completes within 15s.
- Missing-key deployments fail loudly with a clean 4xx, not a silent
  5xx.
