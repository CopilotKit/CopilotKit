# QA: Voice Input — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/voice`
- Railway service `showcase-google-antigravity` is healthy (`/api/health` returns 200)
- `OPENAI_API_KEY` is set on the Railway service for the dedicated voice runtime at `/api/copilotkit-voice` (required for the `/transcribe` endpoint)
- The agent server (`src/agent_server.py`) is healthy (`GET /health` lists `voice`); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set there for the model call (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests). The runtime's `voice-demo` agent maps to `${AGENT_URL}/voice`, which `src/agents/registry.py` binds to the shared `neutral_agent()` from `src/agents/chat.py`
- A modern browser that supports `MediaRecorder` (Chromium, Firefox, Safari 14+)
- Microphone hardware available (required only for the mic path in section 3)
- A bundled `public/demo-audio/sample.wav` is present (used for screenshot/preview generation; the in-app sample button no longer fetches it)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/voice`
- [ ] Verify the page header "Voice input" is visible
- [ ] Verify the sample-audio row (`data-testid="voice-sample-audio"`) is visible
- [ ] Verify the caption reads `Sample: "What is the weather in Tokyo?"`
- [ ] Verify the "Play sample" button (`data-testid="voice-sample-audio-button"`) is enabled
- [ ] Verify `<CopilotChat />` renders a message composer (`data-testid="copilot-chat-input"`)
- [ ] Verify the composer shows a microphone button (`data-testid="copilot-start-transcribe-button"`) — this is the authoritative signal that `transcriptionService` is mounted on `/api/copilotkit-voice`

### 2. Sample-audio path (no mic permission required)

- [ ] Click the "Play sample" button
- [ ] Immediately, the chat textarea (`data-testid="copilot-chat-textarea"`) contains the canned phrase "What is the weather in Tokyo?" (no async round-trip; no "Transcribing…" state)
- [ ] The button stays enabled
- [ ] Click send (`data-testid="copilot-send-button"`)
- [ ] Within 10 seconds, the agent responds with a text answer or a weather-related tool render (WeatherCard, custom-catchall card, or default tool card — depending on which tool-rendering mode is active on this page)

### 3. Mic path (manual)

- [ ] Click the microphone button (`data-testid="copilot-start-transcribe-button"`) in the composer
- [ ] Grant microphone permission at the browser prompt
- [ ] Speak "Hello" clearly, then click the mic button again (now `data-testid="copilot-finish-transcribe-button"`) to stop recording
- [ ] Within 5 seconds, the textarea contains text matching "hello" (case-insensitive)
- [ ] Click send
- [ ] Agent responds within 10 seconds

### 4. Error Handling

- [ ] Deny microphone permission, click the mic button
- [ ] Verify the UI handles permission denial gracefully (no crash, mic button remains visible)

## Expected Results

- Sample button click populates the textarea synchronously (no perceptible delay)
- Agent response renders within 10 seconds of send
- No console errors during the successful paths
- Whisper transcription via the mic path returns text resembling what was spoken (deployment must have `OPENAI_API_KEY` configured)
