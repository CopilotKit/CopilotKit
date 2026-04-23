# QA: Voice Input — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/voice`
- Railway service `showcase-langgraph-python` is healthy (`/api/health` returns 200)
- `OPENAI_API_KEY` is set on the Railway service (shared with other demos)
- A modern browser that supports `MediaRecorder` (Chromium, Firefox, Safari 14+)
- Microphone hardware available (required only for the mic path in section 3)
- A bundled `public/demo-audio/sample.wav` saying "What is the weather in Tokyo?" is present

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
- [ ] Verify the button label flips to "Transcribing…" and the button is disabled
- [ ] Within 5 seconds, the chat textarea (`data-testid="copilot-chat-textarea"`) contains text that includes "weather" (case-insensitive) AND/OR "Tokyo" (case-insensitive)
- [ ] The button label returns to "Play sample" and the button is re-enabled
- [ ] Click send (`data-testid="copilot-send-button"`)
- [ ] Within 10 seconds, the agent responds with a weather-related tool render (WeatherCard, custom-catchall card, or default tool card — depending on which tool-rendering mode is active on this page)

### 3. Mic path (manual)

- [ ] Click the microphone button (`data-testid="copilot-start-transcribe-button"`) in the composer
- [ ] Grant microphone permission at the browser prompt
- [ ] Speak "Hello" clearly, then click the mic button again (now `data-testid="copilot-finish-transcribe-button"`) to stop recording
- [ ] Within 5 seconds, the textarea contains text matching "hello" (case-insensitive)
- [ ] Click send
- [ ] Agent responds within 10 seconds

### 4. Error Handling

- [ ] In DevTools → Network, block requests to `/demo-audio/sample.wav`
- [ ] Click "Play sample"
- [ ] Verify the row shows the error state (`data-testid="voice-sample-audio-error"`) reading "Error — see console"
- [ ] Verify no page crash; composer remains interactive
- [ ] Remove the block and click "Play sample" again — verify the button recovers and completes the round-trip

- [ ] Deny microphone permission, click the mic button
- [ ] Verify the UI handles permission denial gracefully (no crash, mic button remains visible)

## Expected Results

- Sample-audio transcription completes within 5 seconds for the 3-5s clip
- Weather-related tool response renders within 10 seconds of send
- No console errors during the successful paths
- Error states are visible and recoverable (re-clicking after a block removal should succeed)
- Whisper transcription is stable enough that "weather" OR "Tokyo" keywords appear in the transcribed text across runs
